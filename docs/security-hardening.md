# Bloc 5 — Renforcement de la sécurité

Ce bloc ajoute des contrôles de défense en profondeur à l'API. Les contrôles côté navigateur ne remplacent jamais les validations côté serveur.

## Mesures implémentées

### Authentification et OTP
- Mot de passe : 10 caractères minimum, avec au moins une minuscule, une majuscule et un chiffre.
- Codes OTP : validation stricte de six chiffres, expiration courte et nombre d'essais plafonné par code.
- Renvoi de code : délai minimum côté stockage OTP et limitation de débit par adresse IP.
- Vérification et renvoi OTP : réponses génériques lorsque le compte n'est pas disponible afin de réduire l'énumération de comptes.
- Réinitialisation du mot de passe : les sessions actives sont révoquées après changement du mot de passe.

### Sessions et jetons
- Jeton d'accès signé explicitement en HS256 et vérifié en n'acceptant que HS256.
- Session contrôlée côté base de données à chaque requête authentifiée.
- Cookies de session HttpOnly, SameSite=Lax et Secure en production.
- Rotation du jeton de rafraîchissement et révocation serveur des sessions.

### Protection HTTP et API
- Helmet pour les en-têtes HTTP de sécurité.
- Contrôle de l'en-tête Origin sur les requêtes de modification, en complément de CORS.
- Réponses d'authentification marquées `Cache-Control: no-store`.
- Limites de taille du JSON et des corps de webhooks.
- Limitation de débit différenciée pour connexion, inscription, vérification OTP, renvoi OTP, récupération/réinitialisation de mot de passe, fichiers, paiements et routes publiques.
- Compteurs de débit persistés dans PostgreSQL : ils sont partagés entre plusieurs instances API et ne dépendent pas de la mémoire d'un seul processus. Les adresses IP sont pseudonymisées par HMAC avant stockage.
- Nettoyage périodique des compteurs expirés.
- Les journaux d'erreur n'enregistrent plus les paramètres de requête ni l'objet d'erreur complet, et les réponses ne divulguent plus les noms de contraintes SQL.

### Configuration de production
- Secrets JWT et PHONE_HASH_PEPPER : 32 caractères minimum en production, valeurs d'exemple interdites.
- Origines CORS : origines HTTPS exactes uniquement, sans joker ni chemin.
- Resend et l'adresse d'expédition doivent être configurés en production.
- Le nombre de reverse proxies de confiance est configurable avec `TRUST_PROXY_HOPS`. Il doit correspondre exactement à l'infrastructure réelle.

## Migration requise

Appliquer `db/migrations/019_api_rate_limits.sql` avant de déployer cette version. La table `api_rate_limits` est utilisée par les middleware de limitation de débit.

## Points opérationnels à traiter avant ouverture publique

1. Définir `NODE_ENV=production`, des secrets aléatoires distincts et longs, les origines HTTPS réelles et `TRUST_PROXY_HOPS`.
2. Configurer Resend pour les inscriptions et récupérations par email.
3. Le fournisseur SMS actuel est volontairement limité à la console en développement et refuse l'envoi en production. L'inscription et la récupération par téléphone nécessitent donc l'intégration d'un fournisseur SMS réel avant d'activer ces parcours.
4. Les limites de débit sont partagées par PostgreSQL. Il faut surveiller la taille de la table et vérifier que le nettoyage périodique s'exécute.
5. Les tests de sécurité et la suite API globale restent à exécuter lors du bloc final de validation.

## Couverture de régression ajoutée

`api/test/security.test.ts` vérifie la normalisation des numéros camerounais, le rejet d'une origine non autorisée et le format des codes OTP.
