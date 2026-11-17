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
- Limitation de débit différenciée : connexion 5/15 min, inscription 5/h, vérification OTP 10/15 min, renvoi OTP et récupération 3/15 min, réinitialisation 5/15 min ; les fichiers, paiements, webhooks et routes publiques ont également leurs propres seuils.
- Compteurs de débit persistés dans PostgreSQL : ils sont partagés entre plusieurs instances API et ne dépendent pas de la mémoire d'un seul processus. Les adresses IP sont pseudonymisées par HMAC avant stockage.
- Nettoyage périodique des compteurs expirés.
- Les événements d'authentification (échecs et succès de connexion, vérification du compte, réinitialisation du mot de passe et révocation de sessions) sont inscrits dans le journal d'audit existant. Les identifiants utilisés pour les échecs sont pseudonymisés.
- Les journaux d'erreur n'enregistrent plus les paramètres de requête ni l'objet d'erreur complet, et les réponses ne divulguent plus les noms de contraintes SQL.

### Configuration de production
- Secrets JWT et PHONE_HASH_PEPPER : 32 caractères minimum en production, valeurs d'exemple interdites ; coût bcrypt minimal de 12.
- Origines CORS : origines HTTPS exactes uniquement, sans joker ni chemin.
- Resend et l'adresse d'expédition doivent être configurés en production.
- Le nombre de reverse proxies de confiance est configurable avec `TRUST_PROXY_HOPS`. Il doit correspondre exactement à l'infrastructure réelle.

## Migration requise

Appliquer `db/migrations/019_api_rate_limits.sql` avant de déployer cette version. La table `api_rate_limits` est utilisée par les middleware de limitation de débit.

## Points opérationnels à traiter avant ouverture publique

1. Définir `NODE_ENV=production`, des secrets aléatoires distincts et longs, les origines HTTPS réelles et `TRUST_PROXY_HOPS`.
2. Configurer Resend pour les inscriptions et récupérations par email.
3. Le fournisseur SMS SmsPro doit être configuré et testé en production (MTN et Orange). Une réponse HTTP acceptée ne prouve pas la livraison au téléphone ; suivre les identifiants et accusés de réception du fournisseur.
4. Les limites de débit sont partagées par PostgreSQL. Il faut surveiller la taille de la table et vérifier que le nettoyage périodique s'exécute.
5. Les tests de sécurité et la suite API globale restent à exécuter lors du bloc final de validation.

## Retraits en production — fournisseur non disponible

Aucun fournisseur réel de décaissement Mobile Money n'est actuellement intégré. Le fournisseur de retrait simulé est réservé au développement et aux tests. Avant le déploiement de cette protection, contrôler les retraits historiques dont `provider = 'mock'` et `status = 'succeeded'` : ils ne prouvent pas qu'un transfert réel a été effectué et doivent être rapprochés manuellement avec les relevés du fournisseur. En production, les routes de devis, de confirmation OTP et de demande de retrait échouent volontairement avec `payout_provider_unavailable`. Ne pas réactiver les retraits avant l'intégration et les tests réels d'un fournisseur de décaissement, avec vérification serveur du statut, idempotence et rapprochement des transactions.

## Révocation des sessions

Toute suspension ou désactivation d'un compte révoque immédiatement ses sessions serveur. La réactivation du compte ne restaure pas les anciennes sessions : l'utilisateur doit se reconnecter et terminer le parcours OTP.

## Récupération du compte

La récupération du mot de passe accepte une adresse email vérifiée ou un numéro de téléphone vérifié. Le code est envoyé sur le canal correspondant. En production, les fournisseurs email et SMS doivent être configurés et testés pour les deux canaux.

## Vérification de l'historique Git

Un ancien changement de la PR #1 a supprimé `cookies.txt`, mais la suppression d'un fichier ne retire pas automatiquement son contenu des commits antérieurs. Exécuter Gitleaks sur tout l'historique Git, sans limiter les commits à une seule branche. Si un cookie de session encore valide ou un secret de signature a été exposé, révoquer les sessions concernées et renouveler le secret JWT. Si un secret permanent a été publié, le révoquer chez son fournisseur. Ne réécrire l'historique partagé qu'après coordination, car cette opération modifie les références Git des collaborateurs.

## Couverture de régression ajoutée

`api/test/security.test.ts` vérifie la normalisation des numéros camerounais, le rejet d'une origine non autorisée, le format des codes OTP et la robustesse minimale des mots de passe.
