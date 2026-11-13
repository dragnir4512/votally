import { Router, type Request } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ah, HttpError, toCamel } from '../http.js';
import { q, withTx, type Db } from '../db.js';
import { consumeOtp, hashTarget, issueOtp, maskPhone, normalizePhone } from '../security.js';
import { defaultPaymentProvider, getPaymentProvider, sms, type PaymentMethod } from '../providers.js';
import { reconcileProviderPayment } from './webhooks.js';
import { isProd } from '../config.js';

export const publicRouter = Router();

/** Concours visible publiquement (jamais les brouillons ; mot de passe vérifié pour les concours privés). */
async function loadPublicContest(req: Request, slug: string) {
  const c = (await q(`SELECT * FROM contests WHERE slug = $1 AND status IN ('active','paused','closed')`, [slug.toLowerCase()])).rows[0];
  if (!c) throw new HttpError(404, 'Concours introuvable', 'not_found');
  if (c.visibility === 'private' && c.access_password_hash) {
    const given = req.header('x-contest-password') ?? '';
    if (!given || !(await bcrypt.compare(given, c.access_password_hash))) throw new HttpError(401, 'Mot de passe du concours requis', 'password_required');
  }
  return c;
}

const resultsVisible = (c: any) => c.results_display === 'realtime' || (c.results_display === 'on_close' && ['closed'].includes(c.status));

// ---------- Page du concours ----------
publicRouter.get('/contests/:slug', ah(async (req, res) => {
  const c = await loadPublicContest(req, req.params.slug as string);
  const [cands, packs] = await Promise.all([
    q('SELECT id, number, name, description, image_key FROM candidates WHERE contest_id = $1 AND is_active ORDER BY sort_order, number', [c.id]),
    q('SELECT id, label, votes_count, price_xaf FROM vote_packs WHERE contest_id = $1 AND is_active ORDER BY votes_count', [c.id]),
  ]);
  res.json({
    contest: toCamel({ id: c.id, name: c.name, slug: c.slug, description: c.description, rules: c.rules, organizer_name: c.organizer_name,
      status: c.status, vote_type: c.vote_type, vote_price_xaf: c.vote_price_xaf, currency: c.currency, starts_at: c.starts_at, ends_at: c.ends_at,
      max_choices_per_vote: c.max_choices_per_vote, free_votes_per_period: c.free_votes_per_period, free_vote_period_hours: c.free_vote_period_hours,
      results_display: c.results_display, default_locale: c.default_locale, theme: c.theme, banner_key: c.banner_key, site_content: c.site_content }),
    candidates: cands.rows.map((x) => toCamel(x)),
    packs: packs.rows.map((x) => toCamel(x)),
  });
}));

publicRouter.get('/contests/:slug/results', ah(async (req, res) => {
  const c = await loadPublicContest(req, req.params.slug as string);
  if (!resultsVisible(c)) throw new HttpError(403, 'Les résultats ne sont pas publics pour le moment', 'results_hidden');
  const r = await q('SELECT candidate_id, number, name, image_key, valid_votes, rank FROM contest_results WHERE contest_id = $1 AND is_active ORDER BY rank, number', [c.id]);
  const total = r.rows.reduce((s, x) => s + Number(x.valid_votes), 0);
  res.json({ status: c.status, totalVotes: total,
    results: r.rows.map((x) => ({ ...toCamel(x), percent: total ? Math.round((Number(x.valid_votes) / total) * 1000) / 10 : 0 })) });
}));

// ---------- Choix du votant ----------
const choicesSchema = z.array(z.object({ candidateId: z.string().uuid(), quantity: z.number().int().min(1).max(100000) })).min(1).max(50)
  .refine((a) => new Set(a.map((x) => x.candidateId)).size === a.length, 'Candidat en double');

/** Le nombre de candidats par vote est vérifié AVANT tout paiement (la base le revérifie en dernier recours). */
function assertChoiceCount(contest: { max_choices_per_vote: number }, choices: unknown[]) {
  if (choices.length > contest.max_choices_per_vote) {
    throw new HttpError(400, `Ce concours autorise ${contest.max_choices_per_vote} candidat(s) par vote au maximum`, 'too_many_choices');
  }
}

async function assertCandidates(c: Db, contestId: string, choices: { candidateId: string }[]) {
  const ids = choices.map((x) => x.candidateId);
  const ok = await c.query('SELECT count(*)::int AS n FROM candidates WHERE contest_id = $1 AND is_active AND id = ANY($2::uuid[])', [contestId, ids]);
  if (ok.rows[0].n !== ids.length) throw new HttpError(400, 'Candidat invalide pour ce concours', 'invalid_candidate');
}

// ---------- Vote gratuit : code SMS puis vote ----------
publicRouter.post('/contests/:slug/otp', ah(async (req, res) => {
  const body = z.object({ phone: z.string() }).parse(req.body);
  const phone = normalizePhone(body.phone);
  const c = await loadPublicContest(req, req.params.slug as string);
  if (c.status !== 'active' || !['free', 'mixed'].includes(c.vote_type)) throw new HttpError(409, 'Ce concours n\'accepte pas de votes gratuits actuellement', 'free_votes_closed');
  const code = await withTx(null, (cx) => issueOtp(cx, 'free_vote', 'sms', phone, req.ip));
  await sms.send(phone, `VOTALLY : votre code de vote est ${code} (valable 10 min)`);
  res.json({ message: 'Code envoyé par SMS', ...(isProd ? {} : { devCode: code }) });
}));

publicRouter.post('/contests/:slug/votes/free', ah(async (req, res) => {
  const body = z.object({ phone: z.string(), code: z.string().regex(/^\d{6}$/), choices: choicesSchema, locale: z.enum(['fr', 'en']).optional() }).parse(req.body);
  const phone = normalizePhone(body.phone);
  const c = await loadPublicContest(req, req.params.slug as string);
  if (!(await consumeOtp('free_vote', phone, body.code))) throw new HttpError(400, 'Code invalide ou expiré', 'invalid_code');

  assertChoiceCount(c, body.choices);
  const votes = body.choices.reduce((s, x) => s + x.quantity, 0);
  const out = await withTx(null, async (cx) => {
    await assertCandidates(cx, c.id, body.choices);
    // Le quota par numéro et par période, l'état du concours et la cohérence sont contrôlés par la base (triggers)
    const o = (await cx.query(
      `INSERT INTO vote_orders (contest_id, kind, status, votes_count, voter_phone_hash, voter_phone_masked, ip, user_agent, locale, expires_at)
       VALUES ($1,'free','pending',$2,$3,$4,$5,$6,$7, now() + interval '15 minutes') RETURNING id, reference`,
      [c.id, votes, hashTarget(phone), maskPhone(phone), req.ip ?? null, req.header('user-agent')?.slice(0, 300) ?? null, body.locale ?? null])).rows[0];
    for (const ch of body.choices) {
      await cx.query('INSERT INTO vote_order_choices (order_id, contest_id, candidate_id, quantity) VALUES ($1,$2,$3,$4)', [o.id, c.id, ch.candidateId, ch.quantity]);
    }
    await cx.query('SELECT confirm_free_order($1)', [o.id]);
    return o;
  });
  res.status(201).json({ reference: out.reference, votes, status: 'confirmed' });
}));


/** Calcul du prix côté serveur (jamais fourni par le client). Partagé par le devis et la création de commande. */
async function priceFor(c: any, body: { packId?: string; choices: { quantity: number }[] }) {
  const chosen = body.choices.reduce((s, x) => s + x.quantity, 0);
  let votes = chosen; let subtotal = chosen * c.vote_price_xaf; let packId: string | null = null;
  if (body.packId) {
    const p = (await q('SELECT * FROM vote_packs WHERE id = $1 AND contest_id = $2 AND is_active', [body.packId, c.id])).rows[0];
    if (!p) throw new HttpError(400, 'Pack invalide', 'invalid_pack');
    votes = p.votes_count; subtotal = p.price_xaf; packId = p.id;
  }
  if (chosen !== votes) throw new HttpError(400, `La répartition (${chosen}) doit totaliser ${votes} vote(s)`, 'choices_mismatch');
  // Les montants manipulés par JavaScript doivent rester des entiers sûrs avant insertion en base.
  if (!Number.isSafeInteger(votes) || votes < 1 || !Number.isSafeInteger(subtotal) || subtotal < 1) {
    throw new HttpError(422, 'Montant ou nombre de votes hors limites.', 'order_amount_out_of_range');
  }
  return { votes, subtotal, packId };
}

// ---------- Vote payant : création de la commande + demande de paiement ----------
const orderSchema = z.object({
  method: z.enum(['mtn_momo', 'orange_money']),
  phone: z.string().optional(),
  email: z.string().email('Adresse e-mail invalide').optional(),
  packId: z.string().uuid().optional(),
  choices: choicesSchema,
  locale: z.enum(['fr', 'en']).optional(),
});

// Devis : le votant voit le total (prix + frais) AVANT de lancer le paiement. Aucun effet de bord.
publicRouter.post('/contests/:slug/quote', ah(async (req, res) => {
  const body = orderSchema.parse(req.body);
  const c = await loadPublicContest(req, req.params.slug as string);
  if (c.status !== 'active' || !['paid', 'mixed'].includes(c.vote_type)) throw new HttpError(409, 'Ce concours n\'accepte pas de votes payants actuellement', 'paid_votes_closed');
  assertChoiceCount(c, body.choices);
  const { votes, subtotal } = await priceFor(c, body);
  const fee = defaultPaymentProvider().estimateFee(subtotal);
  res.json({ votes, subtotalXaf: subtotal, feeXaf: fee, totalXaf: subtotal + fee, currency: 'XAF' });
}));

publicRouter.post('/contests/:slug/orders', ah(async (req, res) => {
  const body = orderSchema.parse(req.body);
  const idem = req.header('idempotency-key')?.slice(0, 100) || null;
  const c = await loadPublicContest(req, req.params.slug as string);
  if (c.status !== 'active' || !['paid', 'mixed'].includes(c.vote_type)) throw new HttpError(409, 'Ce concours n\'accepte pas de votes payants actuellement', 'paid_votes_closed');
  if (!body.phone) throw new HttpError(400, 'Numéro Mobile Money requis', 'phone_required');
 const phone = normalizePhone(body.phone);
const provider = defaultPaymentProvider();

if (provider.name === 'notchpay' && !body.email) {
  throw new HttpError(400, 'Adresse e-mail requise pour le paiement', 'email_required');
}

assertChoiceCount(c, body.choices);

  // Rejeu avec la même clé : on renvoie la commande existante
  if (idem) {

    const ex = (await q(
      `SELECT
         o.reference,
         o.status,
         o.subtotal_xaf,
         o.fee_xaf,
         o.total_xaf,
         o.expires_at,
         p.authorization_url
       FROM vote_orders o
       LEFT JOIN payments p ON p.order_id = o.id
       WHERE o.idempotency_key = $1
         AND o.contest_id = $2`,
      [idem, c.id],
    )).rows[0];

    if (ex) {
      return res.json({
        reference: ex.reference,
        status: ex.status,
        subtotalXaf: ex.subtotal_xaf,
        feeXaf: ex.fee_xaf,
        totalXaf: ex.total_xaf,
        expiresAt: ex.expires_at,
        authorizationUrl: ex.authorization_url ?? null,
        replayed: true,
      });
    }

  }

  const created = await withTx(null, async (cx) => {
    await assertCandidates(cx, c.id, body.choices);
    const { votes, subtotal, packId } = await priceFor(c, body);

    // Montants calculés côté serveur, jamais fournis par le client ; la base les revérifie (CHECK orders_amounts)
    const fee = provider.estimateFee(subtotal);
    const bps: number = (await cx.query('SELECT current_commission_bps() AS v')).rows[0].v;
    const commission = Math.floor((subtotal * bps + 5000) / 10000);
    const o = (await cx.query(
      `INSERT INTO vote_orders (contest_id, kind, status, votes_count, pack_id, unit_price_xaf, subtotal_xaf, fee_xaf, total_xaf,
         commission_rate_bps, commission_xaf, creator_net_xaf, voter_phone_hash, voter_phone_masked, ip, user_agent, locale, idempotency_key,
         expires_at)
       VALUES ($1,'paid','pending',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
         now() + make_interval(mins => COALESCE(setting_int('order_expiry_minutes'), 15)::int))
       RETURNING id, reference, total_xaf, expires_at`,
      [c.id, votes, packId, c.vote_price_xaf, subtotal, fee, subtotal + fee, bps, commission, subtotal - commission,
       hashTarget(phone), maskPhone(phone), req.ip ?? null, req.header('user-agent')?.slice(0, 300) ?? null,
       body.locale ?? null, idem])).rows[0];
    for (const ch of body.choices) {
      await cx.query('INSERT INTO vote_order_choices (order_id, contest_id, candidate_id, quantity) VALUES ($1,$2,$3,$4)', [o.id, c.id, ch.candidateId, ch.quantity]);
    }
    const pay = (await cx.query(
       `INSERT INTO payments (
    order_id, provider, method, amount_xaf, fee_xaf,
    payer_phone_masked, payer_email
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7)
  RETURNING id`,
  [
    o.id,
    provider.name,
    body.method,
    subtotal + fee,
    fee,
    maskPhone(phone),
    body.email ?? null,
  ],
)).rows[0];
    return { order: o, paymentId: pay.id as string, subtotal, fee, total: subtotal + fee, votes };
  });

  // Appel à l'agrégateur HORS transaction ; en cas d'échec, le paiement est clos proprement
  let authorizationUrl: string | undefined;

  try {
    const { providerReference, authorizationUrl: paymentUrl } = await provider.initiate({
  reference: created.order.reference,
  amountXaf: created.total,
  method: body.method as PaymentMethod,
  phone,
  email: body.email,
});

authorizationUrl = paymentUrl;

await q(
  `UPDATE payments
   SET provider_reference = $2,
       authorization_url = $3,
       status = 'pending'
   WHERE id = $1`,
  [created.paymentId, providerReference, authorizationUrl ?? null],
);
  } catch (e) {
    console.error('[paiement] initiation refusée', e);
    await q('SELECT fail_payment($1, $2)', [created.paymentId, 'initiation impossible']);
    throw new HttpError(502, 'Le service de paiement est indisponible, réessaie dans un instant', 'provider_unavailable');
  }
  res.status(201).json({
  reference: created.order.reference,
  status: 'pending',
  votes: created.votes,
  subtotalXaf: created.subtotal,
  feeXaf: created.fee,
  totalXaf: created.total,
  currency: 'XAF',
  expiresAt: created.order.expires_at,
  authorizationUrl: authorizationUrl ?? null,
  instructions: authorizationUrl
    ? 'Finalise ton paiement sur la page sécurisée de Notch Pay.'
    : 'Valide la demande de paiement reçue sur ton téléphone (code USSD)',
});
}));

// Reçu / suivi : aucune donnée personnelle ; la référence est aléatoire (CSPRNG)
publicRouter.get('/orders/:reference', ah(async (req, res) => {
  const r = (await q(
    `SELECT o.reference, o.status, o.kind, o.votes_count, o.total_xaf, o.confirmed_at, c.name AS contest_name, c.slug
       FROM vote_orders o JOIN contests c ON c.id = o.contest_id WHERE o.reference = $1`, [req.params.reference])).rows[0];
  if (!r) throw new HttpError(404, 'Commande introuvable', 'not_found');
  res.json({ order: toCamel(r) });
}));


// Vérification manuelle du paiement auprès de l'agrégateur
publicRouter.post('/orders/:reference/verify', ah(async (req, res) => {
  const payment = (await q(
    `SELECT p.provider, p.provider_reference
       FROM payments p
       JOIN vote_orders o ON o.id = p.order_id
      WHERE o.reference = $1`,
    [req.params.reference],
  )).rows[0];

  if (!payment) {
    throw new HttpError(404, 'Paiement introuvable', 'payment_not_found');
  }

  if (!payment.provider_reference) {
    throw new HttpError(409, 'Référence du paiement indisponible', 'provider_reference_missing');
  }

  const provider = getPaymentProvider(payment.provider);

  if (!provider) {
    throw new HttpError(502, 'Prestataire de paiement indisponible', 'provider_unavailable');
  }

  const verification = await reconcileProviderPayment(
    provider,
    payment.provider_reference,
  );

  const order = (await q(
    `SELECT o.reference, o.status, o.kind, o.votes_count, o.total_xaf,
            o.confirmed_at, c.name AS contest_name, c.slug
       FROM vote_orders o
       JOIN contests c ON c.id = o.contest_id
      WHERE o.reference = $1`,
    [req.params.reference],
  )).rows[0];

  if (!order) {
    throw new HttpError(404, 'Commande introuvable', 'not_found');
  }

  res.json({
    verification,
    order: toCamel(order),
  });
}));
