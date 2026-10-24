# VOTALLY — Passation (état au 24 octobre 2026)

## État d'avancement
- **Bloc 1 terminé : base de données PostgreSQL** (7 migrations, runner, tests d'intégrité — tous verts sur PostgreSQL 16).
- **À faire — Bloc 2 : API** (Node.js + TypeScript + Express) : auth, concours, candidats, vote.
- **À faire — Bloc 3 : page de vote publique** (Next.js, mobile-first, FR/EN).
- Les paiements réels (Phase 3 du cahier des charges) dépendent de l'ouverture d'un compte chez un agrégateur : **démarche à lancer dès maintenant**.

## Démarrer
```bash
cp .env.example .env            # puis adapter
docker compose up -d db         # PostgreSQL 16
npm install
export DATABASE_URL=postgres://votally:votally@localhost:5432/votally
npm run db:migrate              # applique db/migrations/*.sql (idempotent, checksums)
npm run db:test                 # 60+ contrôles d'intégrité, annulés à la fin (ROLLBACK)
```
Ne jamais modifier une migration déjà appliquée : en créer une nouvelle (le runner refuse sinon).

## Ce que la base garantit déjà (l'API n'a pas à le réimplémenter)
| Garantie | Mécanisme |
|---|---|
| Aucun vote sans commande confirmée | trigger `votes_before_insert` |
| Aucun vote payant sans paiement réussi du bon montant | trigger `vote_orders_require_payment` + CHECK `payments_check_insert` |
| Un paiement ne compte jamais deux fois | index unique `uq_payment_one_success_per_order` + `confirm_payment_and_votes()` rejouable |
| Commission / frais / net cohérents (8 %, arrondi au FCFA) | CHECK `orders_amounts` |
| Prix du vote ≥ minimum plateforme, verrouillé après lancement | triggers sur `contests` |
| Slugs réservés, format, transitions d'état, règlement + 2 candidats avant activation | triggers sur `contests` |
| Quota de votes gratuits par numéro et par période (sans course concurrente) | `vote_orders_before_insert` + verrou consultatif |
| Ledger immuable et équilibré (débits = crédits, vérifié au COMMIT) | triggers `block_mutation`, `ledger_check_balanced` |
| Retrait seulement si KYC validé, concours clos + 72 h, fonds non gelés, solde suffisant | `payouts_before_insert`, `creator_withdrawable_xaf()` |
| Concours clos : paiement tardif (> 15 min) → argent conservé, `needs_refund`, aucun vote | `confirm_payment_and_votes()` |

## Contrat pour l'API (Bloc 2)
**Acteur dans l'audit** : au début de chaque transaction d'écriture :
`SELECT set_config('votally.actor_id', '<uuid utilisateur>', true);`

**Vote gratuit** (une transaction) :
1. vérifier le code SMS (`otp_codes`) ;
2. `INSERT vote_orders (kind='free', voter_phone_hash=SHA256(téléphone + PHONE_HASH_PEPPER), …)` ;
3. `INSERT vote_order_choices` ;
4. `SELECT confirm_free_order(order_id)`.

**Vote payant** :
1. `INSERT vote_orders (kind='paid', status='pending', unit_price_xaf, subtotal_xaf, fee_xaf, total_xaf, commission_rate_bps = current_commission_bps(), commission_xaf = round(subtotal × bps / 10000), creator_net_xaf = subtotal − commission_xaf, expires_at)` + `vote_order_choices` ;
2. `INSERT payments` (montant = `total_xaf`) puis appeler l'agrégateur ;
3. à la réception du webhook : vérifier la signature, `INSERT webhook_events` (unique `(provider, event_id)` = anti-rejeu), **revérifier le statut auprès de l'agrégateur**, puis `SELECT confirm_payment_and_votes(payment_id, provider_reference)` ;
4. échec / expiration : `fail_payment(payment_id, raison, expiré?)` ; job chaque minute : `SELECT expire_pending_orders()`.

**Retrait** : `INSERT payouts` (2FA obligatoire, `twofa_verified_at`) → appel API de décaissement → `complete_payout(payout_id, provider, reference)` (ou `UPDATE … status='failed'`).

**Fraude / litige** : `invalidate_vote(vote_id, admin, motif)`, `refund_payment(payment_id, admin, motif)`, gel des fonds : `UPDATE contests SET payout_frozen_at = now(), payout_frozen_reason = '…'`.

**Résultats** : vue `contest_results` (classement, votes payants / gratuits). `reconcile_vote_counts(contest_id)` recalcule les compteurs depuis les votes (utile si un cache Redis dérive).

**Contrôles de santé à surveiller** : `SELECT * FROM ledger_integrity` (doit valoir 0) ; paiements `needs_refund` ; webhooks non traités.

## Pièges et décisions à garder en tête
- **Montants** : entiers FCFA partout (jamais de décimaux).
- **Téléphones des votants** : stockés hachés (+ masqués) ; ne chiffrer le numéro (`voter_phone_enc`) que si un reçu SMS est demandé. **Le poivre ne doit jamais être perdu ni changé** (sinon les quotas de votes gratuits repartent de zéro).
- **Pas de suppression** de votes, commandes, paiements, écritures comptables : on invalide ou on passe une écriture inverse.
- **Concurrence en finale** : les compteurs `candidate_vote_counts` sont mis à jour par trigger (ligne chaude par candidat). Si on dépasse ~200 votes/s sur un même candidat, passer à des compteurs Redis réconciliés par `reconcile_vote_counts()`.
- **Accès** : les droits (propriétaire / gestionnaire / observateur) sont à appliquer dans l'API ; la table `contest_members` les porte. Row Level Security éventuelle : décision à prendre au Bloc 2.
- Le **choix de l'agrégateur** et du **montage des fonds** (voir cahier des charges, section 16) reste ouvert ; la colonne `payments.provider` est volontairement générique.
- Aspects légaux (loi 2024/017, agrément paiement CEMAC, TVA) : à valider avec un juriste / expert-comptable avant le lancement.

## Prochaines étapes recommandées
1. **Maintenant (hors Claude)** : demander l'ouverture d'un compte marchand chez 2 agrégateurs (CinetPay, Notch Pay, Monetbil, Campay…) avec accès API de décaissement.
2. Bloc 2 : API Express + TypeScript (auth, concours, candidats, `vote-orders`, webhooks) en s'appuyant sur les fonctions SQL ci-dessus.
3. Bloc 3 : page de vote Next.js mobile-first, FR/EN, lien et aperçu par candidat.
4. Ensuite : paiements réels en sandbox, KYC et retraits, tableau de bord, administration.
