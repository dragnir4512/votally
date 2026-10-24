# VOTALLY

Plateforme SaaS de concours de vote (marché camerounais : Mobile Money, FCFA).
Voir `HANDOFF.md` pour l'état du projet, le démarrage et le contrat entre la base et l'API.

```
db/migrations/   001 → 007 : schéma PostgreSQL, fonctions, triggers, données de référence
db/tests/        invariants.sql : tests d'intégrité (rollback automatique)
scripts/         migrate.js : exécuteur de migrations
```
