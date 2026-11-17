# Matrice des rôles et permissions VOTALLY

Les rôles globaux du compte et les rôles propres à un concours sont deux niveaux distincts.

- **Compte global** : `creator` ou `admin`. Le rôle `admin` donne accès à l'administration de la plateforme.
- **Membre d'un concours** : `owner`, `manager` ou `viewer`. Les droits ci-dessous sont vérifiés par l'API à chaque requête, indépendamment de l'interface.

## Matrice des permissions

| Action | Propriétaire (`owner`) | Gestionnaire (`manager`) | Observateur (`viewer`) |
|---|---:|---:|---:|
| Consulter le concours, les candidats, le classement et les indicateurs | Oui | Oui | Oui |
| Ajouter, modifier, désactiver ou supprimer des candidats | Oui | Oui | Non |
| Modifier le contenu éditorial et les informations non structurantes | Oui | Oui | Non |
| Ajouter ou remplacer logo et bannière | Oui | Oui | Non |
| Modifier type de vote, prix unitaire, quota, dates, slug, visibilité et affichage des résultats | Oui | Non | Non |
| Créer ou retirer des packs tarifaires | Oui | Non | Non |
| Publier, mettre en pause, reprendre, clôturer ou archiver | Oui | Non | Non |
| Supprimer le concours | Oui | Non | Non |
| Consulter les commandes opérationnelles | Oui | Oui, sans montants | Non |
| Consulter les montants, commissions et soldes | Oui | Non | Non |
| Exporter les résultats CSV | Oui | Oui | Non |
| Consulter l'équipe | Oui | Oui | Non |
| Inviter, changer les rôles ou retirer un collaborateur | Oui | Non | Non |

## Règles d'application

1. Le propriétaire est le seul membre pouvant détenir le rôle `owner` d'un concours.
2. Les invitations ne peuvent attribuer que `manager` ou `viewer`. Le lien expire après 7 jours et son jeton est stocké sous forme hachée.
3. Seul le propriétaire peut modifier le rôle d'un collaborateur. Un collaborateur ne peut jamais se promouvoir propriétaire.
4. Le gestionnaire peut piloter les candidats, le contenu et les opérations, mais les paramètres structurants et les tarifs sont protégés côté API.
5. Les réponses API destinées aux gestionnaires ne contiennent pas les colonnes financières des commandes. Les données financières agrégées restent réservées au propriétaire.
6. L'observateur dispose d'un accès en lecture aux informations de concours, aux candidats, au classement et aux indicateurs non financiers.
7. Masquer un bouton dans l'interface n'est jamais considéré comme une protection : chaque route API applique elle-même le contrôle de rôle.
8. Les permissions sont recalculées depuis la base de données à chaque requête ; un changement ou retrait de rôle prend donc effet immédiatement.

## Routes de gestion d'équipe

- `POST /contests/:id/members/invite` — propriétaire uniquement ; crée une invitation `manager` ou `viewer`.
- `POST /contests/invitations/accept` — utilisateur connecté ; accepte un jeton valide.
- `GET /contests/:id/members` — propriétaire et gestionnaire.
- `PATCH /contests/:id/members/:mid` — propriétaire uniquement ; change entre `manager` et `viewer`.
- `DELETE /contests/:id/members/:mid` — propriétaire uniquement ; révoque l'accès.

## Vérifications de non-régression prévues

La suite API couvre les accès non authentifiés et étrangers, les capacités du gestionnaire, le refus des opérations réservées au propriétaire, le mode lecture seule de l'observateur, la dissimulation des montants financiers et la modification des rôles par le propriétaire.
