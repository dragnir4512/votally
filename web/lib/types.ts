export type Lang = 'fr' | 'en';

export interface ContestPublic {
  id: string; name: string; slug: string;
  description: string | null; rules: string | null; organizerName: string | null;
  status: 'active' | 'paused' | 'closed';
  voteType: 'free' | 'paid' | 'mixed'; votePriceXaf: number; currency: string;
  startsAt: string | null; endsAt: string | null;
  maxChoicesPerVote: number; freeVotesPerPeriod: number; freeVotePeriodHours: number;
  resultsDisplay: 'realtime' | 'on_close' | 'hidden';
  defaultLocale: Lang; theme: Record<string, unknown>; bannerKey: string | null; siteContent: Record<string, unknown>;
}
export interface Candidate { id: string; number: number; name: string; description: string | null; imageKey: string | null }
export interface Pack { id: string; label: string | null; votesCount: number; priceXaf: number }
export interface ContestPage { contest: ContestPublic; candidates: Candidate[]; packs: Pack[] }

export type PayMethod = 'mtn_momo' | 'orange_money' | 'card';
