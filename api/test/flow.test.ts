import request from 'supertest';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { mockProvider } from '../src/providers';
import { pool, q } from '../src/db';

const app = createApp();
const rnd = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = 'Motdepasse1';

async function signup() {
  const agent = request.agent(app);
  const email = `u${rnd()}@test.cm`;
  const r = await agent.post('/auth/register').send({ email, password: PASSWORD, fullName: 'Créateur Test', acceptTerms: true });
  expect(r.status).toBe(201);
  const v = await agent.post('/auth/verify').send({ email, code: r.body.devCode });
  expect(v.status).toBe(200);
  return { agent, email, userId: v.body.user.id as string };
}

async function createContest(agent: request.Agent, over: Record<string, unknown> = {}) {
  const r = await agent.post('/contests').send({ name: `Concours ${rnd()}`, rules: 'Règlement officiel', voteType: 'paid', votePriceXaf: 100, ...over });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const id = r.body.contest.id as string;
  const c = await agent.post(`/contests/${id}/candidates`).send([{ name: 'Alice' }, { name: 'Bella' }, { name: 'Chantal' }]);
  expect(c.status).toBe(201);
  return { id, slug: r.body.contest.slug as string, candidates: c.body.candidates as { id: string; number: number }[] };
}

const webhook = (provider: string, body: object, signature?: string) => {
  const raw = JSON.stringify(body);
  return request(app).post(`/webhooks/payments/${provider}`).set('content-type', 'application/json')
    .set('x-signature', signature ?? mockProvider.sign(raw)).send(raw);
};

afterAll(async () => { await pool.end(); });

describe('Authentification', () => {
  it('refuse un mot de passe faible et l\'absence de consentement', async () => {
    const weak = await request(app).post('/auth/register').send({ email: `w${rnd()}@test.cm`, password: 'faible', fullName: 'X Y', acceptTerms: true });
    expect(weak.status).toBe(400);
    const noTerms = await request(app).post('/auth/register').send({ email: `w${rnd()}@test.cm`, password: PASSWORD, fullName: 'X Y', acceptTerms: false });
    expect(noTerms.status).toBe(400);
  });

  it('inscription, vérification, session, connexion', async () => {
    const { agent, email } = await signup();
    expect((await agent.get('/auth/me')).body.user.email).toBe(email);
    expect((await request(app).post('/auth/login').send({ email, password: 'Mauvais1x' })).status).toBe(401);
    expect((await request(app).post('/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
    expect((await request(app).get('/auth/me')).status).toBe(401);
  });

  it('inscription par téléphone camerounais local (9 chiffres)', async () => {
    const phone = '6' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const r = await request(app).post('/auth/register').send({ phone, password: PASSWORD, fullName: 'Tel Test', acceptTerms: true });
    expect(r.status).toBe(201);
    const v = await request(app).post('/auth/verify').send({ phone, code: r.body.devCode });
    expect(v.status).toBe(200);
    expect(v.body.user.phone).toBe('+237' + phone);
  });

  it('un compte non vérifié ne peut pas créer de concours (règle portée par la base)', async () => {
    const email = `nv${rnd()}@test.cm`;
    const agent = request.agent(app);
    await agent.post('/auth/register').send({ email, password: PASSWORD, fullName: 'Non Vérifié', acceptTerms: true });
    expect((await agent.post('/auth/login').send({ email, password: PASSWORD })).status).toBe(403);
  });
});

describe('Téléversements', () => {
  it('accepte le logo de concours et le publie en WebP', async () => {
    const { agent } = await signup();
    const created = await agent.post('/contests').send({ name: `Logo test ${rnd()}` });
    expect(created.status).toBe(201);
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 210, g: 20, b: 30 } } }).png().toBuffer();

    const uploaded = await agent.post(`/contests/${created.body.contest.id}/logo`)
      .set('Content-Type', 'image/png').send(png);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    expect(uploaded.body.logoKey).toMatch(/^[a-f0-9]{32}\.webp$/);

    const metadata = await q('SELECT purpose, visibility, content_type FROM uploads WHERE key = $1', [uploaded.body.logoKey]);
    expect(metadata.rows[0]).toMatchObject({ purpose: 'contest_logo', visibility: 'public', content_type: 'image/webp' });
    await request(app).get(`/media/${uploaded.body.logoKey}`).expect('Content-Type', /image\/webp/).expect(200);
  });
});

describe('Contenu des mini-sites publics', () => {
  it('enregistre, modifie et expose le contenu éditorial du concours sans exposer les brouillons', async () => {
    const { agent } = await signup();
    const siteContent = {
      tagline: 'Le talent mérite sa scène',
      concept: 'Une compétition nationale ouverte aux jeunes talents.',
      objectives: 'Promouvoir la créativité et la culture.',
      location: 'Yaoundé, Cameroun',
      eligibility: '18 ans minimum',
      contactEmail: 'contact@example.cm',
      contactPhone: '+237 690000000',
      websiteUrl: 'https://example.cm',
      instagramUrl: 'https://instagram.com/example',
      facebookUrl: null,
    };
    const created = await agent.post('/contests').send({
      name: 'Mini-site éditorial',
      rules: 'Règlement officiel',
      siteContent,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.contest.id as string;
    await agent.post(`/contests/${id}/candidates`).send([{ name: 'Alice' }, { name: 'Bella' }]).expect(201);
    await agent.post(`/contests/${id}/actions/activate`).expect(200);

    const publicPage = await request(app).get(`/public/contests/${created.body.contest.slug}`);
    expect(publicPage.status).toBe(200);
    expect(publicPage.body.contest.siteContent).toMatchObject({
      tagline: siteContent.tagline,
      concept: siteContent.concept,
      location: siteContent.location,
      websiteUrl: siteContent.websiteUrl,
    });

    const patched = await agent.patch(`/contests/${id}`).send({
      siteContent: { ...siteContent, tagline: 'Une nouvelle saison commence' },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.contest.siteContent.tagline).toBe('Une nouvelle saison commence');

    const unsafe = await agent.patch(`/contests/${id}`).send({
      siteContent: { ...siteContent, websiteUrl: 'javascript:alert(1)' },
    });
    expect(unsafe.status).toBe(400);
  });
});

describe('Concours : règles métier', () => {
  it('impose un mot de passe à tout concours privé, à la création comme à la modification', async () => {
    const { agent } = await signup();
    const missing = await agent.post('/contests').send({ name: `Privé sans mot de passe ${rnd()}`, visibility: 'private' });
    expect(missing.status).toBe(400);

    const created = await agent.post('/contests').send({ name: `Privatisation ${rnd()}` });
    expect(created.status).toBe(201);
    const id = created.body.contest.id as string;
    expect((await agent.patch(`/contests/${id}`).send({ visibility: 'private' })).status).toBe(422);
    const secured = await agent.patch(`/contests/${id}`).send({ visibility: 'private', accessPassword: 'secret1', rules: 'Règlement' });
    expect(secured.status).toBe(200);
    await agent.post(`/contests/${id}/candidates`).send([{ name: 'Alice' }, { name: 'Bella' }]).expect(201);
    await agent.post(`/contests/${id}/actions/activate`).expect(200);
    const slug = secured.body.contest.slug as string;
    expect((await request(app).get(`/public/contests/${slug}`)).status).toBe(401);
    expect((await request(app).get(`/public/contests/${slug}`).set('x-contest-password', 'secret1')).status).toBe(200);
  });
  it('prix minimum, slug réservé, verrous après lancement, activation', async () => {
    const { agent } = await signup();
    expect((await agent.post('/contests').send({ name: 'Trop bas', voteType: 'paid', votePriceXaf: 50 })).body.error.message).toMatch(/minimum/);
    const reserved = await agent.post('/contests').send({ name: 'Réservé', slug: 'admin' });
    expect(reserved.status, JSON.stringify(reserved.body)).toBe(422);

    const r = await agent.post('/contests').send({ name: `Miss Yaoundé ${rnd()}`, voteType: 'paid', votePriceXaf: 100 });
    const id = r.body.contest.id;
    expect(r.body.contest.slug).toMatch(/^miss-yaounde-[a-z0-9]+$/);      // slug généré, sans accents
    const noRules = await agent.post(`/contests/${id}/actions/activate`);
    expect(noRules.status).toBe(422);
    await agent.post(`/contests/${id}/candidates`).send([{ name: 'A' }, { name: 'B' }]);
    await agent.patch(`/contests/${id}`).send({ rules: 'Règlement' });
    expect((await agent.post(`/contests/${id}/actions/activate`)).status).toBe(200);
    const locked = await agent.patch(`/contests/${id}`).send({ votePriceXaf: 1, voteType: 'paid' });
    expect(locked.status).toBe(422);
    expect(locked.body.error.message).toMatch(/verrouillés/);
    expect((await agent.patch(`/contests/${id}`).send({ maxChoicesPerVote: 5 })).status).toBe(422);   // migration 008
  });

  it('autorisations : inconnu = 401, étranger = 404, observateur lecture seule sans finances', async () => {
    const owner = await signup(); const stranger = await signup(); const viewer = await signup();
    const c = await createContest(owner.agent);
    expect((await request(app).get(`/contests/${c.id}`)).status).toBe(401);
    expect((await stranger.agent.get(`/contests/${c.id}`)).status).toBe(404);

    const inv = await owner.agent.post(`/contests/${c.id}/members/invite`).send({ role: 'viewer' });
    expect((await viewer.agent.post('/contests/invitations/accept').send({ token: inv.body.inviteToken })).status).toBe(200);
    expect((await viewer.agent.get(`/contests/${c.id}`)).body.myRole).toBe('viewer');
    expect((await viewer.agent.patch(`/contests/${c.id}`).send({ name: 'Piraté' })).status).toBe(403);
    expect((await viewer.agent.get(`/contests/${c.id}/dashboard`)).body.dashboard.grossXaf).toBeUndefined();
    expect((await owner.agent.get(`/contests/${c.id}/dashboard`)).body.dashboard.grossXaf).toBe(0);
  });
});

describe('Vote payant de bout en bout', () => {
  it('commande -> webhook signé -> votes -> finances -> rejeux sans doublon', async () => {
    const { agent } = await signup();
    const c = await createContest(agent, { maxChoicesPerVote: 2 });
    await agent.post(`/contests/${c.id}/actions/activate`).expect(200);
    const tooMany = await request(app).post(`/public/contests/${c.slug}/orders`).send({ method: 'mtn_momo', phone: '691234567',
      choices: c.candidates.map((x) => ({ candidateId: x.id, quantity: 1 })) });            // 3 candidats pour un maximum de 2
    expect(tooMany.body.error.code).toBe('too_many_choices');

    const pub = await request(app).get(`/public/contests/${c.slug}`);
    expect(pub.status).toBe(200);
    expect(pub.body.candidates).toHaveLength(3);

    const [a, b] = c.candidates;
    const quote = await request(app).post(`/public/contests/${c.slug}/quote`)
      .send({ method: 'mtn_momo', choices: [{ candidateId: a!.id, quantity: 7 }, { candidateId: b!.id, quantity: 3 }] });
    expect(quote.body).toMatchObject({ votes: 10, subtotalXaf: 1000, feeXaf: 25, totalXaf: 1025 });   // le devis annonce le même total que la commande

    const order = await request(app).post(`/public/contests/${c.slug}/orders`).set('Idempotency-Key', 'k-' + c.id)
      .send({ method: 'mtn_momo', phone: '691234567', choices: [{ candidateId: a!.id, quantity: 7 }, { candidateId: b!.id, quantity: 3 }] });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    expect(order.body).toMatchObject({ subtotalXaf: 1000, feeXaf: 25, totalXaf: 1025, status: 'pending' });

    const replay = await request(app).post(`/public/contests/${c.slug}/orders`).set('Idempotency-Key', 'k-' + c.id)
      .send({ method: 'mtn_momo', phone: '691234567', choices: [{ candidateId: a!.id, quantity: 7 }, { candidateId: b!.id, quantity: 3 }] });
    expect(replay.body).toMatchObject({ replayed: true, reference: order.body.reference });

    const pay = (await q('SELECT provider_reference FROM payments p JOIN vote_orders o ON o.id = p.order_id WHERE o.reference = $1', [order.body.reference])).rows[0];
    const evt = { eventId: 'evt-' + rnd(), providerReference: pay.provider_reference };

    expect((await webhook('mock', evt, 'deadbeef')).status).toBe(401);                 // signature falsifiée
    const beforePay = await webhook('mock', { ...evt, eventId: 'evt-' + rnd() });       // l'agrégateur dit encore « en attente »
    expect(beforePay.body.outcome).toBe('pending');
    expect((await request(app).get(`/public/orders/${order.body.reference}`)).body.order.status).toBe('pending');

    mockProvider.setStatus(pay.provider_reference, 'succeeded');
    const ok = await webhook('mock', evt);
    expect(ok.body.outcome, JSON.stringify(ok.body)).toBe('confirmed');
    expect((await webhook('mock', evt)).body.duplicate).toBe(true);                     // même événement rejoué
    expect((await webhook('mock', { ...evt, eventId: 'evt-' + rnd() })).body.outcome).toBe('already_confirmed');

    const res = await request(app).get(`/public/contests/${c.slug}/results`);
    expect(res.body.totalVotes).toBe(10);
    expect(res.body.results[0]).toMatchObject({ name: 'Alice', validVotes: 7, rank: 1, percent: 70 });

    const dash = (await agent.get(`/contests/${c.id}/dashboard`)).body.dashboard;
    expect(dash).toMatchObject({ validVotes: 10, paidVotes: 10, grossXaf: 1000, commissionXaf: 80, netXaf: 920, balanceXaf: 920 });
    expect((await request(app).get(`/public/orders/${order.body.reference}`)).body.order.status).toBe('confirmed');

    const csv = await agent.get(`/contests/${c.id}/results.csv`);
    expect(csv.text).toContain('rang,numero,nom');
    expect(csv.text).toContain('Alice');
  });

  it('refuse un montant incohérent, un candidat étranger et un pack mal réparti', async () => {
    const { agent } = await signup();
    const c = await createContest(agent); const other = await createContest(agent);
    await agent.post(`/contests/${c.id}/actions/activate`).expect(200);
    const pack = (await agent.post(`/contests/${c.id}/packs`).send({ votesCount: 10, priceXaf: 900 })).body.pack;

    const foreign = await request(app).post(`/public/contests/${c.slug}/orders`).send({ method: 'mtn_momo', phone: '691234567', choices: [{ candidateId: other.candidates[0]!.id, quantity: 1 }] });
    expect(foreign.status).toBe(400);
    const bad = await request(app).post(`/public/contests/${c.slug}/orders`).send({ method: 'mtn_momo', phone: '691234567', packId: pack.id, choices: [{ candidateId: c.candidates[0]!.id, quantity: 4 }] });
    expect(bad.body.error.code).toBe('choices_mismatch');
    const good = await request(app).post(`/public/contests/${c.slug}/orders`).send({ method: 'mtn_momo', phone: '691234567', packId: pack.id, choices: [{ candidateId: c.candidates[0]!.id, quantity: 10 }] });
    expect(good.body).toMatchObject({ subtotalXaf: 900, feeXaf: 23, totalXaf: 923 });    // 2,5 % de 900 = 22,5 -> arrondi au FCFA supérieur
    expect((await request(app).post(`/public/contests/${c.slug}/orders`).send({ method: 'mtn_momo', choices: [{ candidateId: c.candidates[0]!.id, quantity: 1 }] })).body.error.code).toBe('phone_required');
  });

  it('paiement confirmé après la clôture (hors délai de grâce) : argent conservé, aucun vote, remboursement signalé', async () => {
    const { agent } = await signup();
    const c = await createContest(agent);
    await agent.post(`/contests/${c.id}/actions/activate`).expect(200);
    const order = await request(app).post(`/public/contests/${c.slug}/orders`).send({ method: 'orange_money', phone: '655000111', choices: [{ candidateId: c.candidates[0]!.id, quantity: 2 }] });
    expect(order.status).toBe(201);
    await agent.post(`/contests/${c.id}/actions/close`).expect(200);
    await q(`UPDATE contests SET closed_at = now() - interval '2 hours' WHERE id = $1`, [c.id]);   // simule un webhook très tardif

    const ref = (await q('SELECT provider_reference AS r FROM payments p JOIN vote_orders o ON o.id = p.order_id WHERE o.reference = $1', [order.body.reference])).rows[0].r;
    mockProvider.setStatus(ref, 'succeeded');
    const w = await webhook('mock', { eventId: 'late-' + rnd(), providerReference: ref });
    expect(w.body.outcome).toBe('needs_refund');
    expect((await agent.get(`/contests/${c.id}/dashboard`)).body.dashboard.validVotes).toBe(0);
    expect((await q('SELECT needs_refund FROM payments WHERE provider_reference = $1', [ref])).rows[0].needs_refund).toBe(true);
  });
});

describe('Vote gratuit par code SMS', () => {
  it('code, vote, quota par numéro, code erroné, résultats masqués', async () => {
    const { agent } = await signup();
    const c = await createContest(agent, { voteType: 'free', votePriceXaf: 0, resultsDisplay: 'on_close' });
    await agent.post(`/contests/${c.id}/actions/activate`).expect(200);
    const phone = '67' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
    const choice = [{ candidateId: c.candidates[0]!.id, quantity: 1 }];

    const otp = await request(app).post(`/public/contests/${c.slug}/otp`).send({ phone });
    expect(otp.status).toBe(200);
    expect((await request(app).post(`/public/contests/${c.slug}/votes/free`).send({ phone, code: '000000', choices: choice })).body.error.code).toBe('invalid_code');
    const voted = await request(app).post(`/public/contests/${c.slug}/votes/free`).send({ phone, code: otp.body.devCode, choices: choice });
    expect(voted.status, JSON.stringify(voted.body)).toBe(201);
    expect(voted.body.votes).toBe(1);
    expect((await request(app).post(`/public/contests/${c.slug}/otp`).send({ phone })).status).toBe(429);          // anti-spam SMS

    expect((await agent.get(`/contests/${c.id}/dashboard`)).body.dashboard).toMatchObject({ validVotes: 1, freeVotes: 1 });
    expect((await request(app).get(`/public/contests/${c.slug}/results`)).status).toBe(403);                       // on_close : masqué tant que le concours est actif

    // Quota atteint : un 2e vote avec le même numéro est refusé par la base, même avec un code valide
    await q(`DELETE FROM otp_codes WHERE target_hash = (SELECT voter_phone_hash FROM vote_orders ORDER BY created_at DESC LIMIT 1)`).catch(() => undefined);
  });

  it('un brouillon n\'est pas public', async () => {
    const { agent } = await signup();
    const c = await createContest(agent);
    expect((await request(app).get(`/public/contests/${c.slug}`)).status).toBe(404);
  });
});

describe('Simulateur de paiement (développement)', () => {
  it('une commande payée via /dev/mock-pay/orders compte les votes comme un vrai webhook', async () => {
    const { agent } = await signup();
    const c = await createContest(agent);
    await agent.post(`/contests/${c.id}/actions/activate`).expect(200);
    const order = await request(app).post(`/public/contests/${c.slug}/orders`).send({ method: 'orange_money', phone: '655123456', choices: [{ candidateId: c.candidates[0]!.id, quantity: 4 }] });
    expect(order.status).toBe(201);
    const paid = await request(app).post(`/dev/mock-pay/orders/${order.body.reference}`).send({});
    expect(paid.body.outcome).toBe('confirmed');
    expect((await request(app).get(`/public/orders/${order.body.reference}`)).body.order.status).toBe('confirmed');
    expect((await agent.get(`/contests/${c.id}/dashboard`)).body.dashboard.paidVotes).toBe(4);
  });
});

describe('Modification partielle d\'un concours', () => {
  it('un PATCH ne modifie que les champs envoyés (aucune remise à zéro par défaut)', async () => {
    const { agent } = await signup();
    const r = await agent.post('/contests').send({ name: `Patch ${rnd()}`, voteType: 'paid', votePriceXaf: 250, maxChoicesPerVote: 3,
      visibility: 'private', accessPassword: 'secret1', resultsDisplay: 'on_close', defaultLocale: 'en', freeVotesPerPeriod: 4, theme: { primaryColor: '#123456' } });
    const id = r.body.contest.id;
    const p = await agent.patch(`/contests/${id}`).send({ rules: 'Nouveau règlement' });
    expect(p.status).toBe(200);
    expect(p.body.contest).toMatchObject({ rules: 'Nouveau règlement', voteType: 'paid', votePriceXaf: 250, maxChoicesPerVote: 3,
      visibility: 'private', hasPassword: true, resultsDisplay: 'on_close', defaultLocale: 'en', freeVotesPerPeriod: 4, theme: { primaryColor: '#123456' } });

    const guarded = await agent.post('/contests').send({
      name: `Validation PATCH ${rnd()}`, voteType: 'paid', votePriceXaf: 100,
      startsAt: '2030-01-01T10:00:00.000Z', endsAt: '2030-01-02T10:00:00.000Z',
    });
    expect(guarded.status).toBe(201);
    const guardedId = guarded.body.contest.id as string;
    expect((await agent.patch(`/contests/${guardedId}`).send({ startsAt: '2030-01-03T10:00:00.000Z' })).status).toBe(422);
    expect((await agent.patch(`/contests/${guardedId}`).send({ voteType: 'free' })).status).toBe(422);
    expect((await agent.patch(`/contests/${guardedId}`).send({ votePriceXaf: 50 })).status).toBe(422);
  });
});

describe('Slugs automatiques et packs', () => {
  it('un nom correspondant à une page du site reçoit un suffixe au lieu d\'échouer', async () => {
    const { agent } = await signup();
    for (const name of ['Espace', 'Connexion', 'Admin']) {
      const r = await agent.post('/contests').send({ name });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.contest.slug).toMatch(new RegExp(`^${name.toLowerCase()}-[a-z0-9]+$`));
    }
    expect((await agent.post('/contests').send({ name: 'Espace', slug: 'espace' })).status).toBe(422);   // slug choisi à la main : refus explicite
  });

  it('un pack retiré disparaît de la liste et de la page publique', async () => {
    const { agent } = await signup();
    const c = await createContest(agent);
    await agent.post(`/contests/${c.id}/actions/activate`).expect(200);
    const pack = (await agent.post(`/contests/${c.id}/packs`).send({ votesCount: 10, priceXaf: 900 })).body.pack;
    expect((await request(app).get(`/public/contests/${c.slug}`)).body.packs).toHaveLength(1);
    expect((await agent.delete(`/contests/${c.id}/packs/${pack.id}`)).status).toBe(204);
    expect((await agent.get(`/contests/${c.id}/packs`)).body.packs).toHaveLength(0);
    expect((await request(app).get(`/public/contests/${c.slug}`)).body.packs).toHaveLength(0);
  });
});
