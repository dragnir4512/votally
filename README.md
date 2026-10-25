# VOTALLY

Plateforme SaaS de concours de vote (marché camerounais : Mobile Money, FCFA).
Voir `HANDOFF.md` pour l'état du projet, le démarrage et les routes de l'API.

```
db/migrations/   001 → 008 : schéma PostgreSQL, fonctions, triggers, données de référence
db/tests/        invariants.sql : tests d'intégrité (rollback automatique)
api/             API Node.js + TypeScript (Express) — src/ et test/
scripts/         migrate.js : exécuteur de migrations
docs/            cahier des charges (à ajouter)
```
