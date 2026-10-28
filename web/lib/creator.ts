// Types et utilitaires de l'espace organisateur (interface en français ; l'anglais viendra plus tard).
export type Status = 'draft' | 'active' | 'paused' | 'closed' | 'archived';
export type Role = 'owner' | 'manager' | 'viewer';
export type VoteType = 'free' | 'paid' | 'mixed';

export interface Me { id: string; email: string | null; phone: string | null; fullName: string | null; role: 'creator' | 'admin'; kycStatus: string }

export interface MyContest {
  id: string; name: string; slug: string; description: string | null; rules: string | null; organizerName: string | null;
  status: Status; voteType: VoteType; votePriceXaf: number; startsAt: string | null; endsAt: string | null;
  visibility: 'public' | 'private'; hasPassword: boolean; resultsDisplay: 'realtime' | 'on_close' | 'hidden';
  maxChoicesPerVote: number; freeVotesPerPeriod: number; freeVotePeriodHours: number; defaultLocale: 'fr' | 'en';
  theme: Record<string, unknown>; myRole?: Role; candidatesCount?: number; totalVotes?: number;
}
export interface MyCandidate { id: string; number: number; name: string; description: string | null; imageKey: string | null; isActive: boolean }
export interface Dashboard {
  validVotes: number; paidVotes: number; freeVotes: number; pendingOrders: number; openFraudFlags: number;
  grossXaf?: number; commissionXaf?: number; netXaf?: number; balanceXaf?: number;
}
export interface Pack { id: string; label: string | null; votesCount: number; priceXaf: number }
export interface Member { id: string; role: Role; status: 'invited' | 'active'; fullName: string | null; email: string | null }

export const STATUS_LABEL: Record<Status, string> = { draft: 'Brouillon', active: 'En cours', paused: 'En pause', closed: 'Terminé', archived: 'Archivé' };
export const VOTE_TYPE_LABEL: Record<VoteType, string> = { free: 'Gratuit', paid: 'Payant', mixed: 'Mixte' };
export const ROLE_LABEL: Record<Role, string> = { owner: 'Propriétaire', manager: 'Gestionnaire', viewer: 'Observateur' };

export const xaf = (n: number | undefined) => `${new Intl.NumberFormat('fr-FR').format(n ?? 0)} FCFA`;
export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** ISO -> valeur d'un champ datetime-local (heure locale du navigateur). */
export function toInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Adresses publiques d'un concours : sous-domaine (production) et accès direct par chemin. */
export function publicUrls(slug: string) {
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3001';
  const proto = typeof window !== 'undefined' ? window.location.protocol : 'https:';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return { subdomain: `${proto}//${slug}.${root}`, path: `${origin}/${slug}` };
}

/** « Nom ; description » par ligne -> candidats (lignes vides ignorées, 500 maximum). */
export function parseBulk(text: string): { name: string; description?: string }[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 500).map((line) => {
    const i = line.search(/[;\t]/);
    const name = (i === -1 ? line : line.slice(0, i)).trim().slice(0, 120);
    const description = i === -1 ? '' : line.slice(i + 1).trim().slice(0, 2000);
    return description ? { name, description } : { name };
  }).filter((c) => c.name.length > 0);
}

export interface FormValues {
  name: string; description: string; rules: string; organizerName: string;
  voteType: VoteType; votePriceXaf: string; maxChoicesPerVote: string; freeVotesPerPeriod: string; freeVotePeriodHours: string;
  startsAt: string; endsAt: string; visibility: 'public' | 'private'; accessPassword: string;
  resultsDisplay: 'realtime' | 'on_close' | 'hidden'; defaultLocale: 'fr' | 'en'; primaryColor: string;
}

export const emptyForm: FormValues = {
  name: '', description: '', rules: '', organizerName: '', voteType: 'free', votePriceXaf: '100', maxChoicesPerVote: '1',
  freeVotesPerPeriod: '1', freeVotePeriodHours: '24', startsAt: '', endsAt: '', visibility: 'public', accessPassword: '',
  resultsDisplay: 'realtime', defaultLocale: 'fr', primaryColor: '#0E7C66',
};

export function formFromContest(c: MyContest): FormValues {
  return {
    name: c.name, description: c.description ?? '', rules: c.rules ?? '', organizerName: c.organizerName ?? '', voteType: c.voteType,
    votePriceXaf: String(c.votePriceXaf || 100), maxChoicesPerVote: String(c.maxChoicesPerVote), freeVotesPerPeriod: String(c.freeVotesPerPeriod),
    freeVotePeriodHours: String(c.freeVotePeriodHours), startsAt: toInput(c.startsAt), endsAt: toInput(c.endsAt), visibility: c.visibility,
    accessPassword: '', resultsDisplay: c.resultsDisplay, defaultLocale: c.defaultLocale,
    primaryColor: typeof c.theme?.primaryColor === 'string' ? (c.theme.primaryColor as string) : '#0E7C66',
  };
}

/** Corps de requête. Les champs verrouillés après lancement (type, prix, nombre de choix) ne sont jamais envoyés. */
export function buildPayload(v: FormValues, opts: { locked: boolean; existingTheme?: Record<string, unknown> }) {
  const nz = (s: string) => (s.trim() === '' ? null : s.trim());
  const body: Record<string, unknown> = {
    name: v.name.trim(), description: nz(v.description), rules: nz(v.rules), organizerName: nz(v.organizerName),
    freeVotesPerPeriod: Number(v.freeVotesPerPeriod) || 0, freeVotePeriodHours: Number(v.freeVotePeriodHours) || 24,
    startsAt: v.startsAt ? new Date(v.startsAt).toISOString() : null, endsAt: v.endsAt ? new Date(v.endsAt).toISOString() : null,
    visibility: v.visibility, resultsDisplay: v.resultsDisplay, defaultLocale: v.defaultLocale,
    theme: { ...(opts.existingTheme ?? {}), primaryColor: v.primaryColor },
  };
  if (v.visibility === 'public') body.accessPassword = null;
  else if (v.accessPassword.trim()) body.accessPassword = v.accessPassword.trim();
  if (!opts.locked) {
    body.voteType = v.voteType;
    body.votePriceXaf = v.voteType === 'free' ? 0 : Number(v.votePriceXaf) || 0;
    body.maxChoicesPerVote = Math.max(1, Number(v.maxChoicesPerVote) || 1);
  }
  return body;
}

/** Points à vérifier avant publication (les mêmes règles sont appliquées par la base). */
export function publishChecklist(c: MyContest, activeCandidates: number) {
  return [
    { ok: !!c.rules && c.rules.trim() !== '', label: 'Règlement du concours rédigé' },
    { ok: activeCandidates >= 2, label: `Au moins 2 candidats (${activeCandidates} actuellement)` },
    { ok: !c.endsAt || new Date(c.endsAt).getTime() > Date.now(), label: 'Date de fin non dépassée' },
  ];
}
