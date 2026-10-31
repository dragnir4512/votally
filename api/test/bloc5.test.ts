import request from 'supertest';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { mockProvider } from '../src/providers';
import { settlePayouts } from '../src/payouts';
import { pool, q } from '../src/db';

const app = createApp();
const rnd = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = 'Motdepasse1';
afterAll(async () => { await pool.end(); });

async function signup(role: 'creator' | 'admin' = 'creator') {
  const agent = request.agent(app);
  const email = `b5${rnd()}@test.cm`;
  const r = await agent.post('/auth/register').send({ email, password: PASSWORD, fullName: 'Test Bloc5', acceptTerms: true });
  const v = await agent.post('/auth/verify').send({ email, code: r.body.devCode });
  const userId = v.body.user.id as string;
  if (role === 'admin') await q(`UPDATE users SET role = 'admin' WHERE id = $1`, [userId]);   // le rôle est relu en base : pas besoin de se reconnecter
  return { agent, email, userId };
}
const png = (w = 600, h = 300) => sharp({ create: { width: w, height: h, channels: 3, background: '#cc3355' } }).png().toBuffer();
const upload = (agent: request.Agent, url: string, body: Buffer, type = 'image/png') => agent.post(url).set('content-type', type).send(body);

async function paidContest(agent: request.Agent) {
  const r = await agent.post('/contests').send({ name: `Fonds ${rnd()}`, rules: 'R', voteType: 'paid', votePriceXaf: 100 });
  const id = r.body.contest.id as string; const slug = r.body.contest.slug as string;
  const c = (await agent.post(`/contests/${id}/candidates`).send([{ name: 'A' }, { name: 'B' }])).body.candidates as { id: string }[];
  await agent.post(`/contests/${id}/actions/activate`).expect(200);
  return { id, slug, cands: c };
}
/** 60 votes à 100 FCFA : 6 000 de ventes, commission 480, net créateur 5 520. */
async function sellVotes(slug: string, candidateId: string) {
  const o = await request(app).post(`/public/contests/${slug}/orders`).send({ method: 'mtn_momo', phone: '677000333', choices: [{ candidateId, quantity: 60 }] });
  expect(o.status, JSON.stringify(o.body)).toBe(201);
  const p = await request(app).post(`/dev/mock-pay/orders/${o.body.reference}`).send({});
  expect(p.body.outcome).toBe('confirmed');
}
/** Concours payant avec 5 520 FCFA retirables (clos, délai de sécurité écoulé). */
async function fundedContest(agent: request.Agent) {
  const c = await paidContest(agent);
  await sellVotes(c.slug, c.cands[0]!.id);
  await agent.post(`/contests/${c.id}/actions/close`).expect(200);
  await q(`UPDATE contests SET closed_at = now() - interval '80 hours' WHERE id = $1`, [c.id]);
  return c;
}
async function approvedKyc(creator: { agent: request.Agent; userId: string }, admin: { agent: request.Agent }) {
  const doc = await upload(creator.agent, '/me/kyc/documents?kind=id', await png(800, 500));
  expect(doc.status, JSON.stringify(doc.body)).toBe(201);
  const k = await creator.agent.post('/me/kyc').send({ type: 'individual', legalName: 'Mikey Test', idDocumentType: 'cni', idDocumentKey: doc.body.key,
    payoutMethod: 'mtn_momo', payoutPhone: '677123456', payoutAccountName: 'MIKEY TEST' });
  expect(k.status, JSON.stringify(k.body)).toBe(201);
  expect((await admin.agent.post(`/admin/kyc/${k.body.kyc.id}/approve`).send({ nameChecked: true })).status).toBe(200);
  return k.body.kyc.id as string;
}
async function payout(agent: request.Agent, amountXaf: number, code?: string) {
  const otp = await agent.post('/payouts/otp').send({});
  expect(otp.status, JSON.stringify(otp.body)).toBe(200);
  await q(`UPDATE otp_codes SET created_at = created_at - interval '2 minutes', expires_at = expires_at - interval '2 minutes' WHERE purpose = 'payout'`);   // évite le délai anti-spam entre deux codes
  return agent.post('/payouts').send({ amountXaf, code: code ?? otp.body.devCode });
}

describe('Photos', () => {
  it('traite l\'image (800×800 WebP), la sert publiquement et refuse fichiers invalides et droits insuffisants', async () => {
    const owner = await signup(); const stranger = await signup(); const viewer = await signup();
    const c = await paidContest(owner.agent);
    const url = `/contests/${c.id}/candidates/${c.cands[0]!.id}/image`;

    const ok = await upload(owner.agent, url, await png());
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const served = await request(app).get(`/media/${ok.body.imageKey}`);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cache-control']).toContain('immutable');
    const meta = await sharp(served.body).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([800, 800, 'webp']);         // recadré et converti
    expect((await request(app).get(`/public/contests/${c.slug}`)).body.candidates.find((x: any) => x.id === c.cands[0]!.id).imageKey).toBe(ok.body.imageKey);

    expect((await upload(owner.agent, url, Buffer.from('ceci n\'est pas une image'), 'image/png')).body.error.code).toBe('bad_image');   // faux PNG
    expect((await upload(owner.agent, url, Buffer.from('texte'), 'text/plain')).status).toBe(415);
    expect((await upload(owner.agent, url, Buffer.alloc(9 * 1024 * 1024, 1))).status).toBe(413);                                  // plus de 8 Mo
    expect((await upload(stranger.agent, url, await png())).status).toBe(404);                                                     // pas membre
    const inv = await owner.agent.post(`/contests/${c.id}/members/invite`).send({ role: 'viewer' });
    await viewer.agent.post('/contests/invitations/accept').send({ token: inv.body.inviteToken });
    expect((await upload(viewer.agent, url, await png())).status).toBe(403);                                                       // observateur
    expect((await request(app).post(url).set('content-type', 'image/png').send(await png())).status).toBe(401);

    const banner = await upload(owner.agent, `/contests/${c.id}/banner`, await png(2000, 900));
    expect(banner.status).toBe(201);
    expect((await sharp((await request(app).get(`/media/${banner.body.bannerKey}`)).body).metadata()).width).toBe(1600);
    expect((await request(app).get('/media/' + 'a'.repeat(32) + '.webp')).status).toBe(404);
    expect((await request(app).get('/media/..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
  });

  it('le client ne peut pas fixer lui-même une clé de fichier', async () => {
    const owner = await signup();
    const c = await paidContest(owner.agent);
    const victim = await signup();
    const kycDoc = await upload(victim.agent, '/me/kyc/documents?kind=id', await png());
    await owner.agent.patch(`/contests/${c.id}/candidates/${c.cands[0]!.id}`).send({ imageKey: kycDoc.body.key, name: 'A2' });
    const row = (await q('SELECT image_key FROM candidates WHERE id = $1', [c.cands[0]!.id])).rows[0];
    expect(row.image_key).toBeNull();
    expect((await request(app).get(`/media/${kycDoc.body.key}`)).status).toBe(404);          // une pièce KYC n'est jamais servie publiquement
  });
});

describe('Vérification d\'identité (KYC)', () => {
  it('dépôt, contrôle d\'appartenance des pièces, examen par un administrateur, refus puis nouvelle demande', async () => {
    const user = await signup(); const other = await signup(); const admin = await signup('admin');
    const doc = await upload(user.agent, '/me/kyc/documents?kind=id', await png(800, 500));
    const body = { type: 'individual', legalName: 'Mikey Test', idDocumentType: 'cni', idDocumentKey: doc.body.key, payoutMethod: 'mtn_momo', payoutPhone: '677123456', payoutAccountName: 'MIKEY TEST' };

    expect((await upload(user.agent, '/me/kyc/documents?kind=id', Buffer.from('rien'))).status).toBe(415);
    const pdf = await upload(user.agent, '/me/kyc/documents?kind=org', Buffer.from('%PDF-1.4 test'), 'application/pdf');
    expect(pdf.status).toBe(201);
    expect((await other.agent.post('/me/kyc').send(body)).body.error.code).toBe('invalid_document');      // pièce d'un autre utilisateur
    expect((await user.agent.post('/me/kyc').send({ ...body, idDocumentKey: pdf.body.key })).body.error.code).toBe('invalid_document');   // mauvais usage
    expect((await user.agent.post('/me/kyc').send({ ...body, type: 'organization' })).body.error.code).toBe('invalid_document');           // organisation sans documents

    const sent = await user.agent.post('/me/kyc').send(body);
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.kyc.payoutPhoneMasked).toBe('+237** *** *56');
    expect((await user.agent.post('/me/kyc').send(body)).status).toBe(409);                                // déjà en cours
    expect((await user.agent.get('/auth/me')).body.user.kycStatus).toBe('pending');

    expect((await user.agent.get('/admin/kyc')).status).toBe(403);                                         // simple utilisateur
    expect((await request(app).get('/admin/kyc')).status).toBe(401);
    expect((await admin.agent.get('/admin/kyc')).body.items.some((i: any) => i.id === sent.body.kyc.id)).toBe(true);
    const detail = await admin.agent.get(`/admin/kyc/${sent.body.kyc.id}`);
    expect(detail.body.documents).toHaveLength(1);
    expect(JSON.stringify(detail.body)).not.toContain('payout_phone');
    const file = await admin.agent.get(`/admin/files/${detail.body.documents[0].key}`);
    expect(file.status).toBe(200);
    expect(file.headers['cache-control']).toBe('private, no-store');
    expect((await q(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'file.view' AND object_id = $1`, [detail.body.documents[0].key])).rows[0].n).toBe(1);
    expect((await user.agent.get(`/admin/files/${detail.body.documents[0].key}`)).status).toBe(403);

    expect((await admin.agent.post(`/admin/kyc/${sent.body.kyc.id}/approve`).send({})).status).toBe(400);              // confirmation du nom obligatoire
    expect((await admin.agent.post(`/admin/kyc/${sent.body.kyc.id}/reject`).send({ reason: 'non' })).status).toBe(400); // motif trop court
    expect((await admin.agent.post(`/admin/kyc/${sent.body.kyc.id}/reject`).send({ reason: 'Photo illisible, merci de renvoyer' })).status).toBe(200);
    expect((await admin.agent.post(`/admin/kyc/${sent.body.kyc.id}/approve`).send({ nameChecked: true })).status).toBe(409);   // déjà traité
    expect((await user.agent.get('/me/kyc')).body.kyc).toMatchObject({ status: 'rejected', rejectionReason: 'Photo illisible, merci de renvoyer' });

    const again = await user.agent.post('/me/kyc').send(body);                                              // nouvelle demande autorisée après un refus
    expect(again.status).toBe(201);
    expect((await admin.agent.post(`/admin/kyc/${again.body.kyc.id}/approve`).send({ nameChecked: true })).status).toBe(200);
    expect((await user.agent.get('/auth/me')).body.user.kycStatus).toBe('approved');
  });

  it('retirer le rôle administrateur est immédiat (rôle relu en base)', async () => {
    const admin = await signup('admin');
    expect((await admin.agent.get('/admin/overview')).status).toBe(200);
    await q(`UPDATE users SET role = 'creator' WHERE id = $1`, [admin.userId]);
    expect((await admin.agent.get('/admin/overview')).status).toBe(403);
  });
});

describe('Retraits', () => {
  it('parcours complet : délai de sécurité, KYC, double authentification, succès, échec, retrait en cours puis réglé, gel des fonds', async () => {
    const creator = await signup(); const admin = await signup('admin');
    mockProvider.nextPayoutOutcome = 'succeeded';
    const c1 = await paidContest(creator.agent);
    await sellVotes(c1.slug, c1.cands[0]!.id);

    let bal = (await creator.agent.get('/me/balance')).body.balance;
    expect(bal).toMatchObject({ totalXaf: 5520, withdrawableXaf: 0, lockedXaf: 5520, minPayoutXaf: 5000 });      // concours encore ouvert
    await creator.agent.post(`/contests/${c1.id}/actions/close`).expect(200);
    expect((await creator.agent.get('/me/balance')).body.balance.withdrawableXaf).toBe(0);                       // clos mais délai de 72 h non écoulé
    await q(`UPDATE contests SET closed_at = now() - interval '80 hours' WHERE id = $1`, [c1.id]);
    expect((await creator.agent.get('/me/balance')).body.balance.withdrawableXaf).toBe(5520);

    expect((await creator.agent.post('/payouts/otp').send({})).body.error.code).toBe('kyc_required');            // pas de retrait sans identité vérifiée
    await approvedKyc(creator, admin);
    expect((await creator.agent.get('/payouts/quote?amountXaf=5000')).body).toEqual({ amountXaf: 5000, feeXaf: 100, netXaf: 4900 });

    const bad = await payout(creator.agent, 5000, '000000');
    expect(bad.body.error.code).toBe('invalid_code');
    expect((await payout(creator.agent, 1000)).status).toBe(422);                                                // sous le seuil de 5 000 FCFA
    expect((await payout(creator.agent, 9000)).status).toBe(422);                                                // supérieur au solde retirable

    const ok = await payout(creator.agent, 5000);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.payout).toMatchObject({ status: 'succeeded', amountXaf: 5000, feeXaf: 100, netXaf: 4900 });
    bal = (await creator.agent.get('/me/balance')).body.balance;
    expect(bal).toMatchObject({ totalXaf: 520, withdrawableXaf: 520, inFlightXaf: 0 });                          // 5 520 − 5 000 débités

    // Échec chez l'agrégateur : aucun débit comptable, le solde reste disponible
    const c2 = await fundedContest(creator.agent);
    expect((await creator.agent.get('/me/balance')).body.balance.withdrawableXaf).toBe(6040);
    mockProvider.nextPayoutOutcome = 'failed';
    const failed = await payout(creator.agent, 5000);
    expect(failed.body.payout.status).toBe('failed');
    expect((await creator.agent.get('/me/balance')).body.balance).toMatchObject({ totalXaf: 6040, withdrawableXaf: 6040 });

    // Retrait en cours : somme réservée, puis réglé par la tâche de fond
    mockProvider.nextPayoutOutcome = 'processing';
    const pending = await payout(creator.agent, 5000);
    expect(pending.body.payout.status).toBe('processing');
    expect((await creator.agent.get('/me/balance')).body.balance).toMatchObject({ withdrawableXaf: 1040, inFlightXaf: 5000 });
    expect((await payout(creator.agent, 5000)).status).toBe(422);                                                // la somme réservée ne peut pas être retirée deux fois
    mockProvider.setPayoutStatus(pending.body.payout.id, 'succeeded');
    await settlePayouts(0);
    await settlePayouts(0);                                                                                       // rejouable sans effet de bord
    expect((await creator.agent.get('/me/balance')).body.balance).toMatchObject({ totalXaf: 1040, withdrawableXaf: 1040, inFlightXaf: 0 });
    expect((await q(`SELECT count(*)::int AS n FROM ledger_transactions WHERE payout_id = $1`, [pending.body.payout.id])).rows[0].n).toBe(1);
    const history = (await creator.agent.get('/payouts')).body.payouts.map((p: any) => p.status);
    expect(history).toEqual(expect.arrayContaining(['succeeded', 'failed']));

    // Gel des fonds par un administrateur
    expect((await admin.agent.post(`/admin/contests/${c2.id}/freeze`).send({ reason: 'x' })).status).toBe(400);
    expect((await admin.agent.post(`/admin/contests/${c2.id}/freeze`).send({ reason: 'Suspicion de fraude, vérification en cours' })).status).toBe(200);
    expect((await creator.agent.get('/me/balance')).body.balance.withdrawableXaf).toBe(0);
    expect((await admin.agent.get(`/admin/contests?q=${encodeURIComponent(c2.slug)}`)).body.items[0]).toMatchObject({ id: c2.id, payoutFrozenReason: 'Suspicion de fraude, vérification en cours' });
    await admin.agent.post(`/admin/contests/${c2.id}/unfreeze`).send({}).expect(200);
    expect((await creator.agent.get('/me/balance')).body.balance.withdrawableXaf).toBe(1040);
    mockProvider.nextPayoutOutcome = 'succeeded';
  });

  it('un retrait envoyé deux fois à l\'agrégateur n\'est payé qu\'une fois (même référence)', async () => {
    const r1 = await mockProvider.disburse({ reference: 'po-' + rnd(), amountXaf: 1000, method: 'mtn_momo', phone: '+237677000000', name: 'X' });
    const ref = 'po-' + rnd();
    const a = await mockProvider.disburse({ reference: ref, amountXaf: 1000, method: 'mtn_momo', phone: '+237677000000', name: 'X' });
    const b = await mockProvider.disburse({ reference: ref, amountXaf: 1000, method: 'mtn_momo', phone: '+237677000000', name: 'X' });
    expect(b.providerReference).toBe(a.providerReference);
    expect(r1.providerReference).not.toBe(a.providerReference);
  });
});

describe('Administration : remboursements, fraude, tableau de bord', () => {
  it('un paiement tardif apparaît à rembourser ; le remboursement le solde', async () => {
    const creator = await signup(); const admin = await signup('admin');
    const c = await paidContest(creator.agent);
    const o = await request(app).post(`/public/contests/${c.slug}/orders`).send({ method: 'orange_money', phone: '655000999', choices: [{ candidateId: c.cands[0]!.id, quantity: 3 }] });
    await creator.agent.post(`/contests/${c.id}/actions/close`).expect(200);
    await q(`UPDATE contests SET closed_at = now() - interval '2 hours' WHERE id = $1`, [c.id]);
    expect((await request(app).post(`/dev/mock-pay/orders/${o.body.reference}`).send({})).body.outcome).toBe('needs_refund');

    const list = (await admin.agent.get('/admin/refunds')).body.items;
    const item = list.find((x: any) => x.orderReference === o.body.reference);
    expect(item).toMatchObject({ amountXaf: o.body.totalXaf, contestName: expect.any(String) });
    expect((await creator.agent.get('/admin/refunds')).status).toBe(403);
    expect((await admin.agent.post(`/admin/payments/${item.id}/refund`).send({ reason: '' })).status).toBe(400);
    expect((await admin.agent.post(`/admin/payments/${item.id}/refund`).send({ reason: 'Concours clos, remboursé via agrégateur' })).status).toBe(200);
    expect((await admin.agent.get('/admin/refunds')).body.items.some((x: any) => x.id === item.id)).toBe(false);
  });

  it('vue d\'ensemble et alertes de fraude', async () => {
    const creator = await signup(); const admin = await signup('admin');
    const c = await paidContest(creator.agent);
    const flag = (await q(`INSERT INTO fraud_flags (contest_id, rule, score, details) VALUES ($1, 'contest_burst', 80, '{"note":"test"}') RETURNING id`, [c.id])).rows[0];
    const ov = (await admin.agent.get('/admin/overview')).body.overview;
    expect(ov.openFraudFlags).toBeGreaterThanOrEqual(1);
    expect(ov.ledgerImbalanceXaf).toBe(0);                                                                       // le grand livre doit toujours être équilibré
    expect((await admin.agent.get('/admin/fraud')).body.items.some((x: any) => x.id === flag.id)).toBe(true);
    expect((await admin.agent.post(`/admin/fraud/${flag.id}/review`).send({ status: 'bogus' })).status).toBe(400);
    expect((await admin.agent.post(`/admin/fraud/${flag.id}/review`).send({ status: 'dismissed' })).status).toBe(200);
    expect((await admin.agent.post(`/admin/fraud/${flag.id}/review`).send({ status: 'confirmed' })).status).toBe(404);   // déjà traitée
  });
});
