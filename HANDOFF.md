# VOTALLY — Passation (état au 25 octobre 2026)

## Avancement
| Bloc | Contenu | État |
|---|---|---|
| 1 | Base PostgreSQL : 8 migrations, runner, tests d'intégrité | ✅ terminé |
| 2 | **API Node.js + TypeScript** (auth, concours, candidats, vote gratuit / payant, webhooks, tableau de bord) | ✅ terminé (agrégateur **factice**) |
| 2b | Agrégateur réel, SMS/email réels, KYC + retraits (API), administration, upload d'images | ⏳ à faire |
| 3 | Page de vote publique (Next.js, mobile-first, FR/EN) | ⏳ à faire |

## Mise à jour depuis le Bloc 1
Extraire le zip PAR-DESSUS ton dépôt (il ne contient ni `.env` ni `node_modules`). Nouveautés : dossier `api/`, migration `008`, `.env.example`, ce fichier.
```bash
cp .env.example .env            # puis renseigner JWT_SECRET et PHONE_HASH_PEPPER (longues chaînes aléatoires)
npm run db:migrate              # applique 008 (les migrations 001-007 déjà appliquées sont ignorées)
npm run api:install             # installe les dépendances de l'API
npm run api:dev                 # API sur http://localhost:3000   (Node >= 20.6)
npm run api:test                # 11 tests d'intégration (utilise DATABASE_URL)
```
Générer un secret : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
**Lancer les tests sur une base dédiée** (ex. `votally_test`) : ils créent des données que la base conserve (ledger, votes et audit sont immuables par conception).

## Routes de l'API
**Authentification** — `POST /auth/register` · `POST /auth/verify` (code reçu) · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me`.
En développement, la réponse d'inscription contient `devCode` (le code n'est pas envoyé réellement). Session : cookie HttpOnly 30 jours, ou `Authorization: Bearer <jwt>` (Bruno/Postman).

**Créateur** (connecté ; droits `owner` / `manager` / `viewer` par concours)
- `POST /contests` · `GET /contests` · `GET|PATCH|DELETE /contests/:id` (suppression : brouillons)
- `POST /contests/:id/actions/{activate|pause|resume|close|archive}` (propriétaire)
- `GET|POST /contests/:id/candidates` (POST accepte un objet ou une liste) · `PATCH|DELETE /contests/:id/candidates/:cid`
- `GET|POST /contests/:id/packs`
- `POST /contests/:id/members/invite` → lien d'invitation · `POST /contests/invitations/accept` · `GET /contests/:id/members` · `DELETE /contests/:id/members/:mid`
- `GET /contests/:id/dashboard` (finances réservées au propriétaire) · `GET /contests/:id/results` · `GET /contests/:id/results.csv` · `GET /contests/:id/orders`

**Public** (sans compte) — pour le Bloc 3
- `GET /public/contests/:slug` (concours + candidats + packs) · `GET /public/contests/:slug/results` (selon `resultsDisplay`)
- Vote gratuit : `POST /public/contests/:slug/otp` {phone} puis `POST /public/contests/:slug/votes/free` {phone, code, choices[]}
- Vote payant : `POST /public/contests/:slug/orders` {method: mtn_momo|orange_money|card, phone, packId?, choices[]} (en-tête `Idempotency-Key` conseillé) → `GET /public/orders/:reference` pour suivre le statut
- Concours privé : en-tête `x-contest-password`.

**Webhook** — `POST /webhooks/payments/:provider` (corps brut + en-tête `x-signature`).
**Développement** — `POST /dev/mock-pay/:providerReference` {status} (absent en production).
Format d'erreur : `{ "error": { "code", "message" } }` ; les règles métier de la base arrivent en 422 avec un message français.

## Principes à ne pas casser
1. **Les montants ne viennent jamais du client** : l'API les calcule (prix × votes, frais, commission) et la base les revérifie.
2. **On ne croit pas un webhook sur parole** : signature → anti-rejeu (`webhook_events`) → `provider.verify()` serveur à serveur → `confirm_payment_and_votes()` (atomique, rejouable).
3. **Un code SMS est consommé dans sa propre transaction** (un essai raté reste compté même si le vote échoue ensuite).
4. **Le nombre de candidats par vote est validé avant paiement** (défaut trouvé par les tests : sans cela, l'erreur survenait après le débit du votant).
5. Les téléphones des votants ne sont stockés que hachés (+ masqués). **Ne jamais perdre ni changer `PHONE_HASH_PEPPER`.**

## Reste à faire (Bloc 2b)
- **Agrégateur réel** : écrire un adaptateur implémentant `PaymentProvider` (`api/src/providers.ts`) pour l'agrégateur choisi, puis l'ajouter à `PAYMENT_PROVIDER`. Remplacer `FEE_RATE_BPS` par le barème réel.
- **SMS réel** (interface `SmsProvider`) et **email réel** pour les codes d'inscription.
- **KYC et retraits** : endpoints `POST /me/kyc`, `POST /payouts` (2FA obligatoire) + appel à l'API de décaissement puis `complete_payout()` ; la base applique déjà toutes les règles.
- **Administration** : validation KYC, invalidation de votes (`invalidate_vote`), remboursements (`refund_payment`), alertes de fraude (`fraud_flags`), gel de fonds.
- **Anti-fraude actif** : règles qui alimentent `fraud_flags` (rafales, appareils multiples) ; CAPTCHA sur le vote gratuit.
- **Images** : upload candidats / bannière (compression WebP) vers un stockage objet.
- **Sous-domaines** : le front lit le slug depuis `slug.votally.com` et appelle `/public/contests/:slug` (DNS wildcard + certificat wildcard en production).
- **Sécurité** : expiration glissante des sessions, verrouillage progressif des connexions, 2FA TOTP, tâche de reprise des webhooks non traités (`webhook_events WHERE processed_at IS NULL`).

## Avant la mise en production
Avis juridique (loi 2024/017, agrément paiement CEMAC, TVA), choix d'hébergement, test d'intrusion, sauvegardes testées. Voir le cahier des charges, sections 10, 12 et 16.
