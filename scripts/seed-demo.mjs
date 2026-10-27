#!/usr/bin/env node
// Crée un concours de démonstration via l'API (qui doit tourner, hors production) :
//   node scripts/seed-demo.mjs            -> API_URL par défaut http://localhost:3000
// Affiche l'adresse du concours à ouvrir dans le navigateur.
const API = process.env.API_URL ?? 'http://localhost:3000';
const WEB = process.env.WEB_URL ?? 'http://localhost:3001';

async function call(path, { method = 'POST', body, cookie } = {}) {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return { json, res };
}

const email = `demo-${Math.random().toString(36).slice(2, 8)}@votally.test`;
const reg = await call('/auth/register', { body: { email, password: 'Motdepasse1', fullName: 'Organisateur Démo', acceptTerms: true } });
if (!reg.json.devCode) throw new Error('devCode absent : l\'API tourne-t-elle en mode production ?');
const ver = await call('/auth/verify', { body: { email, code: reg.json.devCode } });
const cookie = ver.res.headers.get('set-cookie').split(';')[0];

const { json: { contest } } = await call('/contests', { cookie, body: {
  name: 'Miss Démo', organizerName: 'Comité Démo', voteType: 'mixed', votePriceXaf: 100, maxChoicesPerVote: 2,
  description: 'Concours de démonstration VOTALLY.\nVote gratuit (code SMS) ou par Mobile Money.',
  rules: 'Un vote gratuit par numéro toutes les 24 h. Les votes payants sont définitifs.',
  theme: { primaryColor: '#0E7C66' } } });
const names = ['Aïcha Mbarga', 'Brenda Tchoua', 'Chantal Nkoulou', 'Diane Fotso', 'Estelle Ndzié', 'Flore Atangana'];
await call(`/contests/${contest.id}/candidates`, { cookie, body: names.map((name, i) => ({ name, description: `Candidate n°${i + 1}` })) });
for (const [votesCount, priceXaf] of [[5, 450], [10, 850], [50, 4000]]) await call(`/contests/${contest.id}/packs`, { cookie, body: { votesCount, priceXaf } });
await call(`/contests/${contest.id}/actions/activate`, { cookie });

console.log(`\n✔ Concours créé : ${contest.name}`);
console.log(`  Page de vote   : ${WEB}/${contest.slug}`);
console.log(`  Sous-domaine   : http://${contest.slug}.localhost:3001   (à ouvrir dans Chrome ou Edge)`);
console.log(`  Organisateur   : ${email} / Motdepasse1\n`);
