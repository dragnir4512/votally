import { Router, type Request } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ah, HttpError, toCamel, uuidParam } from '../http.js';
import { q, withTx } from '../db.js';
import { config } from '../config.js';
import { randomToken, requireAuth, sha256 } from '../security.js';
import { processImage } from '../images.js';
import { bodyBuffer, checkQuota, rawFile, storeFile } from './media.js';

export const contestsRouter = Router();
contestsRouter.use(requireAuth);

type Role = 'owner' | 'manager' | 'viewer';

async function needRole(req: Request, contestId: string, allowed: Role[]): Promise<Role> {
  const r = await q('SELECT role FROM contest_members WHERE contest_id = $1 AND user_id = $2 AND status = \'active\'', [contestId, req.user!.id]);
  const role = r.rows[0]?.role as Role | undefined;
  if (!role) throw new HttpError(404, 'Concours introuvable', 'not_found');            // ne révèle pas l'existence
  if (!allowed.includes(role)) throw new HttpError(403, 'Droits insuffisants pour cette action', 'forbidden');
  return role;
}

export function slugify(s: string): string {
  const base = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
  return base.length >= 3 ? base : 'concours';
}

// Forme des champs SANS valeur par défaut : sert au PATCH (seuls les champs envoyés changent).
const contestShape = {
  name: z.string().trim().min(3).max(120),
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/, 'Le slug doit contenir 3 à 32 caractères minuscules, chiffres ou tirets.').optional(),
  description: z.string().max(5000).nullish(),
  rules: z.string().max(20000).nullish(),
  organizerName: z.string().max(120).nullish(),
  category: z.string().max(80).nullish(),
  voteType: z.enum(['free', 'paid', 'mixed']),
  votePriceXaf: z.number().int().min(0),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
  visibility: z.enum(['public', 'private']),
  accessPassword: z.string().min(4).max(100).nullish(),
  resultsDisplay: z.enum(['realtime', 'on_close', 'hidden']),
  maxChoicesPerVote: z.number().int().min(1).max(50),
  freeVotesPerPeriod: z.number().int().min(0).max(100),
  freeVotePeriodHours: z.number().int().min(1).max(720),
  defaultLocale: z.enum(['fr', 'en']),
  theme: z.record(z.string(), z.any()),
  siteContent: z.object({
    tagline: z.string().max(180).nullish(),
    concept: z.string().max(5000).nullish(),
    objectives: z.string().max(3000).nullish(),
    location: z.string().max(180).nullish(),
    eligibility: z.string().max(2000).nullish(),
    contactEmail: z.string().email().max(254).nullish(),
    contactPhone: z.string().max(32).nullish(),
    websiteUrl: z.string().max(500).url().refine((v) => /^https?:\/\//i.test(v), 'URL HTTP(S) requise').nullish(),
    instagramUrl: z.string().url().refine((v) => /^https?:\/\//i.test(v), 'URL HTTP(S) requise').max(500).nullish(),
    facebookUrl: z.string().url().refine((v) => /^https?:\/\//i.test(v), 'URL HTTP(S) requise').max(500).nullish(),
  }).default({}),
};
// Création : les valeurs par défaut s'appliquent ici seulement.
const contestFields = z.object({
  ...contestShape,
  voteType: contestShape.voteType.default('free'),
  votePriceXaf: contestShape.votePriceXaf.default(0),
  visibility: contestShape.visibility.default('public'),
  resultsDisplay: contestShape.resultsDisplay.default('realtime'),
  maxChoicesPerVote: contestShape.maxChoicesPerVote.default(1),
  freeVotesPerPeriod: contestShape.freeVotesPerPeriod.default(1),
  freeVotePeriodHours: contestShape.freeVotePeriodHours.default(24),
  defaultLocale: contestShape.defaultLocale.default('fr'),
  theme: contestShape.theme.default({}),
  siteContent: contestShape.siteContent.default({}),
}).superRefine((b, ctx) => {
  // Un concours privé doit toujours être protégé : le contrôle public se base sur ce hash.
  if (b.visibility === 'private' && !b.accessPassword) {
    ctx.addIssue({ code: 'custom', path: ['accessPassword'], message: 'Un mot de passe est obligatoire pour un concours privé.' });
  }
  if (b.startsAt && b.endsAt && b.endsAt <= b.startsAt) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'La date de fin doit être postérieure à la date de début.' });
  }
  if (b.voteType !== 'free' && b.votePriceXaf < 100) {
    ctx.addIssue({ code: 'custom', path: ['votePriceXaf'], message: 'Le prix minimum d’un vote payant est de 100 FCFA.' });
  }
  if (b.voteType === 'free' && b.votePriceXaf !== 0) {
    ctx.addIssue({ code: 'custom', path: ['votePriceXaf'], message: 'Un concours gratuit ne peut pas avoir de prix de vote.' });
  }
});
const contestPatch = z.object(contestShape).partial().superRefine((b, ctx) => {
  if (b.startsAt && b.endsAt && b.endsAt <= b.startsAt) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'La date de fin doit être postérieure à la date de début.' });
  }
  if (b.voteType !== undefined && b.voteType !== 'free' && b.votePriceXaf !== undefined && b.votePriceXaf < 100) {
    ctx.addIssue({ code: 'custom', path: ['votePriceXaf'], message: 'Le prix minimum d’un vote payant est de 100 FCFA.' });
  }
  if (b.voteType === 'free' && b.votePriceXaf !== undefined && b.votePriceXaf !== 0) {
    ctx.addIssue({ code: 'custom', path: ['votePriceXaf'], message: 'Un concours gratuit ne peut pas avoir de prix de vote.' });
  }
});


const COLUMNS: Record<string, string> = {
  name: 'name', description: 'description', rules: 'rules', organizerName: 'organizer_name', category: 'category',
  voteType: 'vote_type', votePriceXaf: 'vote_price_xaf', startsAt: 'starts_at', endsAt: 'ends_at', visibility: 'visibility',
  resultsDisplay: 'results_display', maxChoicesPerVote: 'max_choices_per_vote', freeVotesPerPeriod: 'free_votes_per_period',
  freeVotePeriodHours: 'free_vote_period_hours', defaultLocale: 'default_locale', theme: 'theme', siteContent: 'site_content', slug: 'slug',
};

const publicContest = (r: any) => { const { access_password_hash, ...rest } = r; return toCamel({ ...rest, has_password: !!access_password_hash }); };

// ---------- Concours ----------
contestsRouter.post('/', ah(async (req, res) => {
  const b = contestFields.parse(req.body);
  const pwHash = b.accessPassword ? await bcrypt.hash(b.accessPassword, config.BCRYPT_COST) : null;
  const wantedSlug = b.slug ? b.slug.toLowerCase() : null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = wantedSlug ?? (attempt === 0 ? slugify(b.name) : `${slugify(b.name).slice(0, 30)}-${Math.random().toString(36).slice(2, 6)}`);
    try {
      const contest = await withTx(req.user!.id, async (c) => (await c.query(
        `INSERT INTO contests (owner_id, name, slug, description, rules, organizer_name, category, vote_type, vote_price_xaf,
           starts_at, ends_at, visibility, access_password_hash, results_display, max_choices_per_vote,
           free_votes_per_period, free_vote_period_hours, default_locale, theme, site_content)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
        [req.user!.id, b.name, slug, b.description ?? null, b.rules ?? null, b.organizerName ?? null, b.category ?? null, b.voteType,
         b.votePriceXaf, b.startsAt ?? null, b.endsAt ?? null, b.visibility, pwHash, b.resultsDisplay, b.maxChoicesPerVote,
         b.freeVotesPerPeriod, b.freeVotePeriodHours, b.defaultLocale, JSON.stringify(b.theme), JSON.stringify(b.siteContent)])).rows[0]);
      return res.status(201).json({ contest: publicContest(contest), url: `https://${contest.slug}.votally.com` });
    } catch (e: any) {
      const taken = e.code === '23505' && e.constraint?.includes('slug');
      const reserved = e.code === '23514' && /Slug réservé/.test(String(e.message));
      if ((taken || reserved) && !wantedSlug) continue;   // slug automatique déjà pris ou réservé : on réessaie avec un suffixe
      throw e;
    }
  }
  throw new HttpError(409, 'Impossible de générer un slug unique, précise-en un', 'slug_taken');
}));

contestsRouter.get('/', ah(async (req, res) => {
  const r = await q(
    `SELECT c.*, m.role AS my_role,
            (SELECT count(*) FROM candidates WHERE contest_id = c.id AND is_active) AS candidates_count,
            (SELECT COALESCE(sum(valid_votes), 0) FROM candidate_vote_counts WHERE contest_id = c.id) AS total_votes
       FROM contests c JOIN contest_members m ON m.contest_id = c.id AND m.user_id = $1 AND m.status = 'active'
      ORDER BY c.created_at DESC LIMIT 200`, [req.user!.id]);
  res.json({ contests: r.rows.map(publicContest) });
}));

contestsRouter.get('/:id', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  const role = await needRole(req, id, ['owner', 'manager', 'viewer']);
  const c = (await q('SELECT * FROM contests WHERE id = $1', [id])).rows[0];
  res.json({ contest: publicContest(c), myRole: role });
}));

// Le gestionnaire pilote le contenu et les opérations ; les paramètres structurants du vote restent au propriétaire.
const OWNER_ONLY_PATCH_FIELDS = new Set([
  'slug', 'voteType', 'votePriceXaf', 'maxChoicesPerVote',
  'freeVotesPerPeriod', 'freeVotePeriodHours', 'startsAt', 'endsAt',
  'visibility', 'accessPassword', 'resultsDisplay',
]);

contestsRouter.patch('/:id', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  const role = await needRole(req, id, ['owner', 'manager']);
  const b = contestPatch.parse(req.body) as Record<string, any>;
  if (role !== 'owner' && Object.keys(b).some((field) => OWNER_ONLY_PATCH_FIELDS.has(field))) {
    throw new HttpError(403, 'Seul le propriétaire peut modifier les paramètres structurants du vote', 'owner_permission_required');
  }
  const current = (await q('SELECT visibility, access_password_hash, starts_at, ends_at, vote_type, vote_price_xaf FROM contests WHERE id = $1', [id])).rows[0];
  if (!current) throw new HttpError(404, 'Concours introuvable', 'not_found');
  // Valide l'état final, pas seulement les champs présents dans le PATCH.
  const nextStartsAt = b.startsAt === undefined ? current.starts_at : b.startsAt;
  const nextEndsAt = b.endsAt === undefined ? current.ends_at : b.endsAt;
  if (nextStartsAt && nextEndsAt && new Date(nextEndsAt).getTime() <= new Date(nextStartsAt).getTime()) {
    throw new HttpError(422, 'La date de fin doit être postérieure à la date de début.', 'invalid_contest_dates');
  }
  const nextVoteType = b.voteType ?? current.vote_type;
  const nextVotePrice = b.votePriceXaf ?? Number(current.vote_price_xaf);
  if (nextVoteType === 'free' && nextVotePrice !== 0) {
    throw new HttpError(422, 'Un concours gratuit ne peut pas avoir de prix de vote.', 'invalid_vote_price');
  }
  if (nextVoteType !== 'free' && nextVotePrice < 100) {
    throw new HttpError(422, 'Le prix minimum d’un vote payant est de 100 FCFA.', 'invalid_vote_price');
  }
  const nextVisibility = b.visibility ?? current.visibility;
  const hasNextPassword = b.accessPassword === undefined ? Boolean(current.access_password_hash) : Boolean(b.accessPassword);
  if (nextVisibility === 'private' && !hasNextPassword) {
    throw new HttpError(422, 'Un mot de passe est obligatoire pour conserver un concours privé.', 'private_password_required');
  }
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, col] of Object.entries(COLUMNS)) {
    if (b[k] === undefined) continue;
    vals.push(k === 'theme' ? JSON.stringify(b[k]) : k === 'slug' ? String(b[k]).toLowerCase() : b[k]);
    sets.push(`${col} = $${vals.length}`);
  }
  if (b.accessPassword !== undefined) {
    vals.push(b.accessPassword ? await bcrypt.hash(b.accessPassword, config.BCRYPT_COST) : null);
    sets.push(`access_password_hash = $${vals.length}`);
  }
  if (!sets.length) throw new HttpError(400, 'Aucun champ à modifier', 'empty_patch');
  vals.push(id);
  // Verrous après lancement (prix, type, slug) et règles d'activation : portés par les triggers de la base
  const row = await withTx(req.user!.id, async (c) => (await c.query(`UPDATE contests SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals)).rows[0]);
  res.json({ contest: publicContest(row) });
}));

// REQ-LIFE : activer, mettre en pause, reprendre, clore, archiver
const TRANSITIONS: Record<string, string> = { activate: 'active', pause: 'paused', resume: 'active', close: 'closed', archive: 'archived' };
contestsRouter.post('/:id/actions/:action', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  await needRole(req, id, ['owner']);
  const to = TRANSITIONS[req.params.action as string];
  if (!to) throw new HttpError(404, 'Action inconnue', 'not_found');
  const row = await withTx(req.user!.id, async (c) => (await c.query('UPDATE contests SET status = $2 WHERE id = $1 RETURNING *', [id, to])).rows[0]);
  res.json({ contest: publicContest(row) });
}));

contestsRouter.delete('/:id', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  await needRole(req, id, ['owner']);
  await withTx(req.user!.id, (c) => c.query('DELETE FROM contests WHERE id = $1', [id]));   // brouillons uniquement (trigger)
  res.status(204).end();
}));

// ---------- Candidats ----------
const candidateBody = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(2000).nullish(), sortOrder: z.number().int().optional() });

contestsRouter.get('/:id/candidates', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  await needRole(req, id, ['owner', 'manager', 'viewer']);
  const r = await q('SELECT * FROM candidates WHERE contest_id = $1 ORDER BY sort_order, number', [id]);
  res.json({ candidates: r.rows.map((x) => toCamel(x)) });
}));

contestsRouter.post('/:id/candidates', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  await needRole(req, id, ['owner', 'manager']);
  const list = z.union([candidateBody, z.array(candidateBody).min(1).max(500)]).parse(req.body);   // import en lot (CSV converti côté client)
  const items = Array.isArray(list) ? list : [list];
  const rows = await withTx(req.user!.id, async (c) => {
    const out = [];
    for (const [i, it] of items.entries()) {
      out.push((await c.query('INSERT INTO candidates (contest_id, name, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
        [id, it.name, it.description ?? null, it.sortOrder ?? i])).rows[0]);
    }
    return out;
  });
  res.status(201).json({ candidates: rows.map((x) => toCamel(x)) });
}));

contestsRouter.patch('/:id/candidates/:cid', ah(async (req, res) => {
  const id = uuidParam(req, 'id'); const cid = uuidParam(req, 'cid');
  await needRole(req, id, ['owner', 'manager']);
  const b = candidateBody.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
  const r = await q(
    `UPDATE candidates SET name = COALESCE($3, name), description = COALESCE($4, description),
            sort_order = COALESCE($5, sort_order), is_active = COALESCE($6, is_active)
      WHERE id = $2 AND contest_id = $1 RETURNING *`, [id, cid, b.name ?? null, b.description ?? null, b.sortOrder ?? null, b.isActive ?? null]);
  if (!r.rows[0]) throw new HttpError(404, 'Candidat introuvable', 'not_found');
  res.json({ candidate: toCamel(r.rows[0]) });
}));

contestsRouter.delete('/:id/candidates/:cid', ah(async (req, res) => {
  const id = uuidParam(req, 'id'); const cid = uuidParam(req, 'cid');
  await needRole(req, id, ['owner', 'manager']);
  await withTx(req.user!.id, (c) => c.query('DELETE FROM candidates WHERE id = $2 AND contest_id = $1', [id, cid]));  // avant lancement uniquement
  res.status(204).end();
}));

// ---------- Photos (traitées côté serveur : recadrage, WebP, métadonnées supprimées) ----------
contestsRouter.post('/:id/candidates/:cid/image', rawFile, ah(async (req, res) => {
  const id = uuidParam(req, 'id'); const cid = uuidParam(req, 'cid');
  await needRole(req, id, ['owner', 'manager']);
  if (!(await q('SELECT 1 FROM candidates WHERE id = $2 AND contest_id = $1', [id, cid])).rows[0]) throw new HttpError(404, 'Candidat introuvable', 'not_found');
  await checkQuota(req.user!.id, ['candidate_image', 'contest_banner'], 300);
  const data = await processImage(bodyBuffer(req), 'candidate');
  const key = await storeFile({ userId: req.user!.id, data, ext: 'webp', contentType: 'image/webp', purpose: 'candidate_image', visibility: 'public' });
  await q('UPDATE candidates SET image_key = $3 WHERE id = $2 AND contest_id = $1', [id, cid, key]);
  res.status(201).json({ imageKey: key });
}));

contestsRouter.post('/:id/banner', rawFile, ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  await needRole(req, id, ['owner', 'manager']);
  await checkQuota(req.user!.id, ['candidate_image', 'contest_banner'], 300);
  const data = await processImage(bodyBuffer(req), 'banner');
  const key = await storeFile({ userId: req.user!.id, data, ext: 'webp', contentType: 'image/webp', purpose: 'contest_banner', visibility: 'public' });
  await q('UPDATE contests SET banner_key = $2 WHERE id = $1', [id, key]);
  res.status(201).json({ bannerKey: key });
}));

contestsRouter.post('/:id/logo', rawFile, ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  await needRole(req, id, ['owner', 'manager']);
  await checkQuota(req.user!.id, ['contest_logo', 'contest_banner', 'candidate_image'], 300);
  const data = await processImage(bodyBuffer(req), 'logo');
  const key = await storeFile({ userId: req.user!.id, data, ext: 'webp', contentType: 'image/webp', purpose: 'contest_logo', visibility: 'public' });
  const row = await q("UPDATE contests SET theme = jsonb_set(theme, '{logoKey}', to_jsonb($2::text), true) WHERE id = $1 RETURNING theme", [id, key]);
  res.status(201).json({ logoKey: row.rows[0].theme.logoKey });
}));

// ---------- Packs de votes ----------
contestsRouter.post('/:id/packs', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  await needRole(req, id, ['owner']);
  const b = z.object({ votesCount: z.number().int().min(1).max(100000), priceXaf: z.number().int().min(1), label: z.string().max(60).nullish() }).parse(req.body);
  const r = await q('INSERT INTO vote_packs (contest_id, label, votes_count, price_xaf) VALUES ($1,$2,$3,$4) RETURNING *', [id, b.label ?? null, b.votesCount, b.priceXaf]);
  res.status(201).json({ pack: toCamel(r.rows[0]) });
}));
contestsRouter.delete('/:id/packs/:pid', ah(async (req, res) => {
  const id = uuidParam(req, 'id'); const pid = uuidParam(req, 'pid');
  await needRole(req, id, ['owner']);
  // Suppression douce : une commande passée peut référencer ce pack
  const r = await q('UPDATE vote_packs SET is_active = false WHERE id = $2 AND contest_id = $1 RETURNING id', [id, pid]);
  if (!r.rows[0]) throw new HttpError(404, 'Pack introuvable', 'not_found');
  res.status(204).end();
}));
contestsRouter.get('/:id/packs', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  await needRole(req, id, ['owner', 'manager', 'viewer']);
  res.json({ packs: (await q('SELECT * FROM vote_packs WHERE contest_id = $1 AND is_active ORDER BY votes_count', [id])).rows.map((x) => toCamel(x)) });
}));

// ---------- Co-gestion par invitation (REQ-TEAM) ----------
contestsRouter.post('/:id/members/invite', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  await needRole(req, id, ['owner']);
  const b = z.object({ role: z.enum(['manager', 'viewer']) }).parse(req.body);
  const token = randomToken();
  await q(`INSERT INTO contest_members (contest_id, role, status, invite_token_hash, invited_by, invite_expires_at)
           VALUES ($1, $2, 'invited', $3, $4, now() + interval '7 days')`, [id, b.role, sha256(token), req.user!.id]);
  res.status(201).json({ inviteToken: token, expiresInDays: 7 });    // à partager par lien (WhatsApp, email) ; seul le haché est conservé
}));

contestsRouter.post('/invitations/accept', ah(async (req, res) => {
  const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
  const r = await q(
    `UPDATE contest_members SET user_id = $2, status = 'active', accepted_at = now(), invite_token_hash = NULL
      WHERE invite_token_hash = $1 AND status = 'invited' AND invite_expires_at > now() RETURNING contest_id, role`, [sha256(token), req.user!.id]);
  if (!r.rows[0]) throw new HttpError(400, 'Invitation invalide ou expirée', 'invalid_invitation');
  res.json(toCamel(r.rows[0]));
}));

contestsRouter.get('/:id/members', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  await needRole(req, id, ['owner', 'manager']);
  const r = await q(`SELECT m.id, m.role, m.status, m.accepted_at, u.full_name, u.email FROM contest_members m
                       LEFT JOIN users u ON u.id = m.user_id WHERE m.contest_id = $1 AND m.status <> 'revoked' ORDER BY m.created_at`, [id]);
  res.json({ members: r.rows.map((x) => toCamel(x)) });
}));

contestsRouter.delete('/:id/members/:mid', ah(async (req, res) => {
  const id = uuidParam(req, 'id'); const mid = uuidParam(req, 'mid');
  await needRole(req, id, ['owner']);
  const r = await q(`UPDATE contest_members SET status = 'revoked', revoked_at = now(), invite_token_hash = NULL
                      WHERE id = $2 AND contest_id = $1 AND role <> 'owner' RETURNING id`, [id, mid]);
  if (!r.rows[0]) throw new HttpError(404, 'Membre introuvable', 'not_found');
  res.status(204).end();
}));

// ---------- Tableau de bord, résultats, commandes ----------
contestsRouter.get('/:id/dashboard', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  const role = await needRole(req, id, ['owner', 'manager', 'viewer']);
  const s = (await q(
    `SELECT
       (SELECT COALESCE(sum(valid_votes), 0) FROM candidate_vote_counts WHERE contest_id = $1) AS valid_votes,
       (SELECT COALESCE(sum(paid_votes), 0)  FROM candidate_vote_counts WHERE contest_id = $1) AS paid_votes,
       (SELECT COALESCE(sum(free_votes), 0)  FROM candidate_vote_counts WHERE contest_id = $1) AS free_votes,
       (SELECT count(*) FROM vote_orders WHERE contest_id = $1 AND status = 'pending') AS pending_orders,
       (SELECT count(*) FROM fraud_flags WHERE contest_id = $1 AND status = 'open') AS open_fraud_flags`, [id])).rows[0];
  const dash: Record<string, unknown> = toCamel(s);
  if (role === 'owner') {                     // REQ-TEAM-004 : seul le propriétaire voit les finances
    const f = (await q(
      `SELECT COALESCE(sum(subtotal_xaf), 0) AS gross_xaf, COALESCE(sum(commission_xaf), 0) AS commission_xaf,
              COALESCE(sum(creator_net_xaf), 0) AS net_xaf
         FROM vote_orders WHERE contest_id = $1 AND kind = 'paid' AND status = 'confirmed'`, [id])).rows[0];
    const bal = (await q('SELECT COALESCE(sum(balance_xaf), 0) AS balance_xaf FROM creator_contest_balances WHERE contest_id = $1', [id])).rows[0];
    Object.assign(dash, toCamel(f), toCamel(bal));
  }
  res.json({ dashboard: dash });
}));

contestsRouter.get('/:id/results', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  await needRole(req, id, ['owner', 'manager', 'viewer']);
  res.json({ results: (await q('SELECT * FROM contest_results WHERE contest_id = $1 ORDER BY rank, number', [id])).rows.map((x) => toCamel(x)) });
}));

contestsRouter.get('/:id/results.csv', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  await needRole(req, id, ['owner', 'manager']);
  const r = await q('SELECT rank, number, name, valid_votes, paid_votes, free_votes FROM contest_results WHERE contest_id = $1 ORDER BY rank, number', [id]);
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n;]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };   // anti injection de formules
  const csv = ['rang,numero,nom,votes_valides,votes_payants,votes_gratuits', ...r.rows.map((x) => [x.rank, x.number, x.name, x.valid_votes, x.paid_votes, x.free_votes].map(esc).join(','))].join('\n');
  res.type('text/csv').attachment('resultats.csv').send('\uFEFF' + csv);
}));

contestsRouter.get('/:id/orders', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  await needRole(req, id, ['owner', 'manager']);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const r = await q(
    `SELECT reference, kind, status, votes_count, subtotal_xaf, fee_xaf, total_xaf, voter_phone_masked, country_code, created_at, confirmed_at
       FROM vote_orders WHERE contest_id = $1 ORDER BY created_at DESC LIMIT $2`, [id, limit]);
  res.json({ orders: r.rows.map((x) => toCamel(x)) });
}));
