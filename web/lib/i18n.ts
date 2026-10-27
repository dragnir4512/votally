import type { Lang } from './types';

const fr = {
  candidates: 'Candidats', results: 'Résultats', rules: 'Règlement', organizedBy: 'Organisé par {name}',
  voteFor: 'Voter pour {n} candidat(s)', selectHint: 'Choisis jusqu\'à {n} candidat(s)', selected: 'Choisi', select: 'Choisir', vote: 'Voter',
  statusClosed: 'Concours terminé', statusPaused: 'Vote en pause', statusSoon: 'Le vote commence le {date}', statusEnds: 'Fin du vote : {date}', statusEnded: 'Le vote est terminé',
  free: 'Gratuit', paid: 'Payant', freeVoteInfo: '{n} vote(s) gratuit(s) par numéro toutes les {h} h', freeLimit: 'Gratuitement, tu peux voter pour {n} candidat(s) à la fois.',
  pricePerVote: '{price} par vote', phone: 'Numéro de téléphone', phoneHelp: 'Ex. 690 00 00 00', invalidPhone: 'Numéro invalide (9 chiffres, ex. 690000000)',
  sendCode: 'Recevoir mon code par SMS', code: 'Code reçu par SMS', codeSent: 'Un code a été envoyé au {phone}', confirmVote: 'Confirmer mon vote', devCode: 'Mode test : code {code}',
  yourVotes: 'Nombre de votes', packs: 'Packs', subtotal: 'Votes', fees: 'Frais de transaction', total: 'Total à payer', votesWord: 'votes',
  payWith: 'Payer avec', momo: 'MTN MoMo', orange: 'Orange Money', card: 'Carte bancaire', pay: 'Payer {amount}', computing: 'Calcul du total…',
  pendingTitle: 'Valide le paiement sur ton téléphone', pendingBody: 'Une demande de paiement de {amount} a été envoyée. Compose ton code secret pour confirmer. Cette page se met à jour toute seule.',
  simulate: 'Simuler le paiement (mode test)',
  doneTitle: 'Merci, ton vote est enregistré !', doneBody: 'Référence : {ref}', shareTitle: 'Partage pour aider ton candidat',
  failedTitle: 'Paiement non abouti', failedBody: 'Aucun vote n\'a été compté. Si ton compte a été débité, le montant te sera remboursé.', retry: 'Réessayer',
  close: 'Fermer', back: 'Retour', share: 'Partager', copyLink: 'Copier le lien', copied: 'Lien copié', shareText: 'Vote pour {name} au concours « {contest} » !',
  noResults: 'Pas encore de votes', resultsHidden: 'Les résultats seront publiés plus tard.', poweredBy: 'Propulsé par VOTALLY',
  privateContest: 'Ce concours est privé', privateBody: 'Demande le lien d\'accès à l\'organisateur.',
  notFoundTitle: 'Concours introuvable', notFoundBody: 'Vérifie l\'adresse ou demande le lien à l\'organisateur.',
  loading: 'Chargement…', genericError: 'Une erreur est survenue. Réessaie dans un instant.', votes: 'vote(s)',
  errors: {
    invalid_code: 'Code incorrect ou expiré.', otp_throttled: 'Patiente une minute avant de redemander un code.',
    too_many_choices: 'Trop de candidats pour ce concours.', free_votes_closed: 'Les votes gratuits sont fermés.',
    paid_votes_closed: 'Les votes payants sont fermés.', phone_required: 'Le numéro Mobile Money est obligatoire.',
    invalid_phone: 'Numéro de téléphone invalide.', rate_limited: 'Trop de tentatives. Réessaie dans un instant.',
    provider_unavailable: 'Le service de paiement est indisponible. Réessaie dans un instant.', choices_mismatch: 'Répartition des votes incorrecte.',
    invalid_candidate: 'Candidat invalide.',
  } as Record<string, string>,
};

const en: typeof fr = {
  candidates: 'Candidates', results: 'Results', rules: 'Rules', organizedBy: 'Organized by {name}',
  voteFor: 'Vote for {n} candidate(s)', selectHint: 'Pick up to {n} candidate(s)', selected: 'Picked', select: 'Pick', vote: 'Vote',
  statusClosed: 'Contest ended', statusPaused: 'Voting paused', statusSoon: 'Voting starts on {date}', statusEnds: 'Voting ends: {date}', statusEnded: 'Voting is over',
  free: 'Free', paid: 'Paid', freeVoteInfo: '{n} free vote(s) per phone number every {h} h', freeLimit: 'For free, you can vote for {n} candidate(s) at a time.',
  pricePerVote: '{price} per vote', phone: 'Phone number', phoneHelp: 'e.g. 690 00 00 00', invalidPhone: 'Invalid number (9 digits, e.g. 690000000)',
  sendCode: 'Get my code by SMS', code: 'Code received by SMS', codeSent: 'A code was sent to {phone}', confirmVote: 'Confirm my vote', devCode: 'Test mode: code {code}',
  yourVotes: 'Number of votes', packs: 'Packs', subtotal: 'Votes', fees: 'Transaction fees', total: 'Total to pay', votesWord: 'votes',
  payWith: 'Pay with', momo: 'MTN MoMo', orange: 'Orange Money', card: 'Bank card', pay: 'Pay {amount}', computing: 'Calculating total…',
  pendingTitle: 'Approve the payment on your phone', pendingBody: 'A payment request of {amount} was sent. Enter your secret code to confirm. This page updates by itself.',
  simulate: 'Simulate payment (test mode)',
  doneTitle: 'Thank you, your vote is recorded!', doneBody: 'Reference: {ref}', shareTitle: 'Share to help your candidate',
  failedTitle: 'Payment did not go through', failedBody: 'No vote was counted. If your account was charged, the amount will be refunded.', retry: 'Try again',
  close: 'Close', back: 'Back', share: 'Share', copyLink: 'Copy link', copied: 'Link copied', shareText: 'Vote for {name} in the "{contest}" contest!',
  noResults: 'No votes yet', resultsHidden: 'Results will be published later.', poweredBy: 'Powered by VOTALLY',
  privateContest: 'This contest is private', privateBody: 'Ask the organizer for the access link.',
  notFoundTitle: 'Contest not found', notFoundBody: 'Check the address or ask the organizer for the link.',
  loading: 'Loading…', genericError: 'Something went wrong. Please try again shortly.', votes: 'vote(s)',
  errors: {
    invalid_code: 'Wrong or expired code.', otp_throttled: 'Please wait a minute before requesting a new code.',
    too_many_choices: 'Too many candidates for this contest.', free_votes_closed: 'Free voting is closed.',
    paid_votes_closed: 'Paid voting is closed.', phone_required: 'A Mobile Money number is required.',
    invalid_phone: 'Invalid phone number.', rate_limited: 'Too many attempts. Please try again shortly.',
    provider_unavailable: 'The payment service is unavailable. Please try again shortly.', choices_mismatch: 'Votes are not split correctly.',
    invalid_candidate: 'Invalid candidate.',
  },
};

export const dictionaries: Record<Lang, typeof fr> = { fr, en };
export type Dict = typeof fr;
export type MsgKey = Exclude<keyof Dict, 'errors'>;

export function makeT(lang: Lang) {
  const d = dictionaries[lang];
  const t = (key: MsgKey, vars: Record<string, string | number> = {}) =>
    String(d[key]).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
  const err = (code?: string, fallback?: string) => (code && d.errors[code]) || (code === 'business_rule' && fallback) || d.genericError;
  return { t, err };
}
export type T = ReturnType<typeof makeT>;
