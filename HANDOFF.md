# VOTALLY — Passation (état au 30 octobre 2026)

## Avancement
| Bloc | Contenu | État |
|---|---|---|
| 1 | Base PostgreSQL : 8 migrations, runner, tests d'intégrité | ✅ terminé |
| 2 | **API Node.js + TypeScript** (auth, concours, candidats, vote gratuit / payant, webhooks, tableau de bord) | ✅ terminé (agrégateur **factice**) |
| 5 | **Photos, vérification d'identité (KYC), retraits, administration** | ✅ terminé (agrégateur et SMS **factices**) |
| 6 | **Agrégateur réel**, SMS et emails réels, anti-fraude active, interface organisateur en anglais, stockage S3 | ⏳ à faire |
| 3 | **Page de vote publique** (Next.js, mobile-first, FR/EN, sous-domaines, vote gratuit et payant, résultats, partage) | ✅ terminé (agrégateur factice) |
| 4 | **Espace organisateur** (inscription, connexion, création et gestion des concours, candidats, packs, équipe, votes, finances) | ✅ terminé (sans retraits ni photos) |

## Mise à jour depuis le Bloc 1
Extraire le zip PAR-DESSUS ton dépôt (il ne contient ni `.env` ni `node_modules`). Nouveautés : dossier `api/`, migration `008`, `.env.example`, ce fichier.
```bash
cp .env.example .env            # puis renseigner JWT_SECRET et PHONE_HASH_PEPPER (longues chaînes aléatoires)
npm run db:migrate              # applique 008, 009 et 010 (les migrations 001-007 déjà appliquées sont ignorées)
npm run api:install             # installe les dépendances de l'API
npm run api:dev                 # API sur http://localhost:3000   (Node >= 20.6)
npm run api:test                # 23 tests d'intégration (utilise DATABASE_URL)
```
Générer un secret : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
**Lancer les tests sur une base dédiée** (ex. `votally_test`) : ils créent des données que la base conserve (ledger, votes et audit sont immuables par conception).

## Bloc 3 — Page de vote publique (dossier `web/`)
**Installer et lancer** (3 terminaux, à la racine du projet) :
```bash
npm run web:install                      # une seule fois
cp web/.env.example web/.env.local       # une seule fois (voir les variables ci-dessous)
npm run api:dev                          # terminal 1 : API sur :3000
npm run web:dev                          # terminal 2 : site sur http://localhost:3001
npm run demo                             # terminal 3 : crée un concours de démonstration et affiche son adresse
```
Tester depuis un téléphone sur le même Wi-Fi : `npm run web:dev:lan`, puis ouvrir `http://<IP-du-PC>:3001/<slug>` (autoriser le pare-feu Windows).

**Adresses** : `http://localhost:3001/<slug>` (accès direct) · `http://<slug>.localhost:3001` (sous-domaine, Chrome/Edge) · `/<slug>/c/<numéro>` (page d'un candidat, avec aperçu de partage WhatsApp/Facebook). En production : `<slug>.votally.com` (DNS + certificat wildcard) ; le middleware réécrit vers `/<slug>`.

**Variables** (`web/.env.local`) : `API_URL` (adresse de l'API, côté serveur), `NEXT_PUBLIC_ROOT_DOMAIN` (domaine racine des sous-domaines), `NEXT_PUBLIC_DEV_MOCK` (1 = bouton « Simuler le paiement » ; **0 en production**, fixé AU MOMENT du build), `NEXT_PUBLIC_MEDIA_URL` (images, vide pour l'instant).

**Fonctionnement** : le navigateur appelle toujours `/api/...` (proxy Next vers l'API : pas de CORS, adresse de l'API privée). La page est rendue côté serveur (SEO, aperçus de partage, ~115 Ko de JavaScript). Vote gratuit : téléphone → code SMS → vote. Vote payant : choix des votes ou d'un pack → **devis serveur (prix + frais)** → paiement Mobile Money/carte → suivi automatique toutes les 3 s → reçu. Le navigateur n'envoie jamais de montant.

**Tests** : `npm run web:test` (31 tests : utilitaires, FR/EN identiques, feuille de vote, espace organisateur). Le parcours complet (pages, sous-domaine, proxy, vote gratuit, devis, paiement simulé, résultats) a aussi été vérifié avec de vrais serveurs.

**À savoir / reste à faire (Bloc 3b)**
- **Aucun test dans un vrai navigateur** n'a été fait côté Claude (pas de navigateur disponible) : l'apparence et le confort sur téléphone sont à valider par toi (captures bienvenues).
- Images des candidats : vignettes à initiales tant que l'upload (Bloc 2b) et `NEXT_PUBLIC_MEDIA_URL` ne sont pas en place ; aperçus de partage sans image.
- Concours privés (mot de passe) : la page affiche un avis ; la saisie du mot de passe reste à faire.
- Messages d'erreur « règle métier » renvoyés par la base : en français même si le visiteur est en anglais.
- Derrière Cloudflare puis Next puis l'API, régler `trust proxy` de l'API selon le nombre réel de proxys (sinon l'IP des votants est fausse).
- CSP, WebSocket / temps réel (actuellement : actualisation des résultats toutes les 15 s), PWA installable : plus tard.

## Bloc 4 — Espace organisateur (dans `web/`)
**Mise à jour depuis le Bloc 3** : extraire le zip par-dessus le projet, puis `npm run db:migrate` (migration 009), redémarrer l'API (`npm run api:dev`) et le site (`npm run web:dev`). Aucune nouvelle dépendance.

**Pages** (interface en **français** ; l'anglais viendra plus tard) :
| Adresse | Rôle |
|---|---|
| `/inscription` · `/connexion` | Création de compte (email ou téléphone + code de vérification), connexion |
| `/espace` | Liste de mes concours |
| `/espace/nouveau` | Création d'un concours (brouillon) |
| `/espace/<id>` | Gestion : **Aperçu** (liste de contrôle avant publication, adresse du concours, pause / reprise / clôture, statistiques, finances), **Candidats** (ajout, import par liste collée, modification, désactivation), **Votes** (classement, commandes, export CSV), **Paramètres** (formulaire complet, packs de votes), **Équipe** (invitations par lien) |
| `/invitation?token=…` | Acceptation d'une invitation (redirige vers la connexion si besoin) |

**Essayer** : `npm run api:dev`, `npm run web:dev`, puis ouvrir http://localhost:3001/inscription (en développement, le code de vérification s'affiche sur la page).
**Droits** : le propriétaire fait tout et voit les finances ; le gestionnaire gère candidats, paramètres, résultats (pas d'argent, pas de clôture) ; l'observateur ne fait que lire.

**Choses à savoir**
- **Modification partielle corrigée** : avant ce bloc, `PATCH /contests/:id` remettait les champs non envoyés à leurs valeurs par défaut (un concours payant redevenait gratuit). Corrigé et testé.
- Les adresses `espace`, `connexion`, `inscription`, `invitation`… sont **réservées** (migration 009). Un concours nommé « Espace » reçoit automatiquement l'adresse `espace-xxxx`.
- Un pack retiré est désactivé (suppression douce), jamais effacé : des commandes peuvent y faire référence.
- La session se vérifie côté navigateur (`/auth/me`) ; les pages `/espace/*` ne sont pas indexées.
- **Pas encore** : retraits et vérification d'identité (KYC), photos des candidats et bannière, réorganisation des candidats par glisser-déposer, interface en anglais, notifications, modification du profil / mot de passe oublié.
- Aucun test dans un vrai navigateur n'a pu être fait côté Claude : l'apparence sur téléphone est à valider par toi (captures bienvenues).

## Bloc 5 — Photos, identité (KYC), retraits, administration
**Mise à jour depuis le Bloc 4** (⚠ **nouvelle dépendance** `sharp` dans l'API) :
```bash
# extraire le zip PAR-DESSUS le projet, puis :
npm run db:migrate          # applique la migration 010 (table des fichiers)
npm run api:install         # installe sharp (traitement d'images) — OBLIGATOIRE
npm run api:dev             # redémarrer l'API ; puis npm run web:dev
npm run make-admin -- ton@email.com   # donne le rôle administrateur à un compte existant (créé via /inscription)
```
**Photos** — l'organisateur ajoute une photo par candidat (liste des candidats) et une bannière (Paramètres). Le serveur relit l'image, applique l'orientation, **supprime les métadonnées** (position GPS…), recadre (800×800 ; bannière 1600×600), convertit en WebP et la stocke sous un nom aléatoire. JPEG/PNG/WebP, 8 Mo maximum, 300 images par jour et par utilisateur. Les images sont servies par `/api/media/<clé>` (cache longue durée). **Le client ne peut plus fixer lui-même une clé de fichier** (`imageKey`/`bannerKey` ignorés par l'API).

**Mon compte** (`/espace/compte`) :
1. **Identité (KYC)** : pièce (CNI/passeport, image ou PDF, reconnus par leur contenu), nom du titulaire, compte Mobile Money qui recevra l'argent ; organisation : récépissé/RCCM + NIU. Les pièces sont **privées** (jamais servies par `/media`) et n'appartiennent qu'à leur déposant.
2. **Retraits** : solde retirable / en attente de clôture (+72 h) / en cours ; montant → frais affichés → **code SMS** envoyé au numéro vérifié → retrait. Une nouvelle demande est possible après un refus.
Règles garanties par la base : KYC validé, seuil minimum (5 000 FCFA), concours clos depuis 72 h, fonds non gelés, solde suffisant, aucun double retrait de la même somme.

**Administration** (`/admin`, rôle `admin`, **relu en base à chaque requête** : le retirer est immédiat) : vue d'ensemble (dont le contrôle d'équilibre du grand livre), examen des dossiers KYC (le validateur doit **cocher que le nom du compte Mobile Money correspond à la pièce** ; chaque ouverture d'une pièce est journalisée dans `audit_logs`), remboursements à effectuer, recherche de concours et **gel des fonds**, alertes de fraude, retraits échoués ou en cours.

**Retraits — comportement face à l'agrégateur** (`api/src/payouts.ts`) : la référence envoyée est l'identifiant du retrait → **un nouvel appel ne paie jamais deux fois**. L'écriture comptable n'est passée qu'au succès ; tant qu'un retrait est en cours, la somme est réservée ; en cas d'échec, rien n'est débité. Une tâche de fond (toutes les minutes) règle les retraits restés en cours ou incertains (`settlePayouts`).

**Contrat à implémenter pour l'agrégateur réel** (interface `PaymentProvider`, `api/src/providers.ts`) : `estimateFee`, `initiate`, `verify`, `verifyWebhookSignature`, `parseWebhook` (encaissements) **et** `estimatePayoutFee`, `disburse` (idempotent sur `reference`), `verifyPayout` (par notre référence ; `unknown` si inconnu). L'agrégateur factice (`mockProvider`) sert de modèle et de banc d'essai.

**À savoir / limites**
- **Taille des envois** : l'API refuse > 8 Mo (413) et l'interface bloque avant l'envoi. À travers le proxy de Next.js, une requête bien plus grosse expire au bout de 30 s sans réponse propre. **En production, imposer la limite sur le serveur frontal** (nginx : `client_max_body_size 9m;`, ou règle Cloudflare).
- **Stockage** : disque local (`UPLOAD_DIR`, par défaut `api/uploads`, ignoré par Git). Pour la production : adaptateur S3/stockage objet (interface `Storage`, `api/src/storage.ts`), **chiffrement au repos des pièces KYC**, **durée de conservation** à définir (loi 2024/017). Les anciennes photos remplacées restent sur disque (nettoyage des fichiers orphelins à écrire).
- Les envois SMS (code de retrait) s'affichent dans la console en développement ; fournisseur SMS réel à brancher (interface `SmsProvider`).
- Les alertes de fraude sont **lues et traitées** par l'administration, mais aucune règle ne les crée encore automatiquement.
- Le remboursement d'un votant se fait **chez l'agrégateur** ; l'administrateur valide ensuite dans VOTALLY (écriture inverse + invalidation des votes).
- Aucun test dans un vrai navigateur n'a pu être fait côté Claude : à valider par toi sur téléphone.

## Routes de l'API
**Authentification** — `POST /auth/register` · `POST /auth/verify` (code reçu) · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me`.
En développement, la réponse d'inscription contient `devCode` (le code n'est pas envoyé réellement). Session : cookie HttpOnly 30 jours, ou `Authorization: Bearer <jwt>` (Bruno/Postman).

**Créateur** (connecté ; droits `owner` / `manager` / `viewer` par concours)
- `POST /contests` · `GET /contests` · `GET|PATCH|DELETE /contests/:id` (suppression : brouillons)
- `POST /contests/:id/actions/{activate|pause|resume|close|archive}` (propriétaire)
- `GET|POST /contests/:id/candidates` (POST accepte un objet ou une liste) · `PATCH|DELETE /contests/:id/candidates/:cid`
- `GET|POST /contests/:id/packs` · `DELETE /contests/:id/packs/:pid` (retrait doux)
- `POST /contests/:id/members/invite` → lien d'invitation · `POST /contests/invitations/accept` · `GET /contests/:id/members` · `DELETE /contests/:id/members/:mid`
- `GET /contests/:id/dashboard` (finances réservées au propriétaire) · `GET /contests/:id/results` · `GET /contests/:id/results.csv` · `GET /contests/:id/orders`

**Public** (sans compte) — utilisé par la page de vote
- `POST /public/contests/:slug/quote` (devis : prix + frais, sans effet de bord)
- `GET /public/contests/:slug` (concours + candidats + packs) · `GET /public/contests/:slug/results` (selon `resultsDisplay`)
- Vote gratuit : `POST /public/contests/:slug/otp` {phone} puis `POST /public/contests/:slug/votes/free` {phone, code, choices[]}
- Vote payant : `POST /public/contests/:slug/orders` {method: mtn_momo|orange_money|card, phone, packId?, choices[]} (en-tête `Idempotency-Key` conseillé) → `GET /public/orders/:reference` pour suivre le statut
- Concours privé : en-tête `x-contest-password`.

**Compte** (connecté) — `POST /me/kyc/documents?kind=id|org` (corps = fichier brut) · `GET|POST /me/kyc` · `GET /me/balance` · `GET /payouts` · `GET /payouts/quote?amountXaf=` · `POST /payouts/otp` · `POST /payouts` {amountXaf, code}.
**Photos** — `POST /contests/:id/candidates/:cid/image` · `POST /contests/:id/banner` (corps = image brute) · `GET /media/:clé` (public).
**Administration** (`admin`) — `GET /admin/overview` · `GET /admin/kyc?status=` · `GET /admin/kyc/:id` · `POST /admin/kyc/:id/{approve|reject}` · `GET /admin/files/:clé` · `GET /admin/refunds` · `POST /admin/payments/:id/refund` · `GET /admin/contests?q=` · `POST /admin/contests/:id/{freeze|unfreeze}` · `GET /admin/fraud` · `POST /admin/fraud/:id/review` · `POST /admin/votes/:id/invalidate` · `GET /admin/payouts`.

**Webhook** — `POST /webhooks/payments/:provider` (corps brut + en-tête `x-signature`).
**Développement** (absent en production) — `POST /dev/mock-pay/orders/:reference` {status?} simule le paiement d'une commande comme un vrai webhook ; `POST /dev/mock-pay/:providerReference` {status} change seulement le statut chez l'agrégateur factice.
Format d'erreur : `{ "error": { "code", "message" } }` ; les règles métier de la base arrivent en 422 avec un message français.

## Principes à ne pas casser
1. **Les montants ne viennent jamais du client** : l'API les calcule (prix × votes, frais, commission) et la base les revérifie.
2. **On ne croit pas un webhook sur parole** : signature → anti-rejeu (`webhook_events`) → `provider.verify()` serveur à serveur → `confirm_payment_and_votes()` (atomique, rejouable).
3. **Un code SMS est consommé dans sa propre transaction** (un essai raté reste compté même si le vote échoue ensuite).
4. **Le nombre de candidats par vote est validé avant paiement** (défaut trouvé par les tests : sans cela, l'erreur survenait après le débit du votant).
5. Les téléphones des votants ne sont stockés que hachés (+ masqués). **Ne jamais perdre ni changer `PHONE_HASH_PEPPER`.**

## Reste à faire (Bloc 6)
- **Agrégateur réel** (dès que ton compte marchand est ouvert) : adaptateur `PaymentProvider` complet (encaissement **et** décaissement), tests de contrat avec leur bac à sable, barème réel des frais (`FEE_RATE_BPS`), webhooks signés.
- **SMS réel** (codes de vote, d'inscription, de retrait) et **emails réels**.
- **Anti-fraude actif** : règles qui alimentent `fraud_flags` (rafales sur un candidat, appareils multiples, numéros en série), CAPTCHA sur le vote gratuit.
- **Stockage S3**, chiffrement et conservation des pièces KYC, nettoyage des fichiers orphelins.
- Interface organisateur en **anglais** ; mot de passe oublié ; modification du profil ; notifications.
- Sous-domaines en production (DNS + certificat wildcard), `trust proxy` selon l'infrastructure, CSP, sauvegardes testées.

## Avant la mise en production
Avis juridique (loi 2024/017, agrément paiement CEMAC, TVA), choix d'hébergement, test d'intrusion, sauvegardes testées. Voir le cahier des charges, sections 10, 12 et 16.
