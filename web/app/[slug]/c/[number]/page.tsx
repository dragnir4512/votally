import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ContestView from '../../../../components/ContestView';
import PrivateNotice from '../../../../components/PrivateNotice';
import { linkBase, loadContest } from '../../../../lib/server-api';

type Props = { params: Promise<{ slug: string; number: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, number } = await params;
  const r = await loadContest(slug);
  const c = r.kind === 'ok' ? r.data.candidates.find((x) => x.number === Number(number)) : undefined;
  if (r.kind !== 'ok' || !c) return { title: 'VOTALLY' };
  const title = r.data.contest.defaultLocale === 'fr' ? `Vote pour ${c.name} — ${r.data.contest.name}` : `Vote for ${c.name} — ${r.data.contest.name}`;
  const description = c.description?.slice(0, 160) ?? r.data.contest.description?.slice(0, 160) ?? title;
  return { title, description, openGraph: { title, description, type: 'website', siteName: 'VOTALLY' } };
}

export default async function CandidatePage({ params }: Props) {
  const { slug, number } = await params;
  const r = await loadContest(slug);
  if (r.kind === 'notfound') notFound();
  if (r.kind === 'private') return <PrivateNotice />;
  const n = Number(number);
  if (!r.data.candidates.some((c) => c.number === n)) notFound();
  return <ContestView {...r.data} base={await linkBase(slug)} focusNumber={n} />;
}
