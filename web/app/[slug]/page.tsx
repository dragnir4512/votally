import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ContestView from '../../components/ContestView';
import PrivateNotice from '../../components/PrivateNotice';
import { linkBase, loadContest } from '../../lib/server-api';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const r = await loadContest(slug);
  if (r.kind !== 'ok') return { title: 'VOTALLY' };
  const { contest } = r.data;
  const description = contest.description?.slice(0, 160) ?? `Vote au concours ${contest.name}`;
  return { title: `${contest.name} — VOTALLY`, description,
    openGraph: { title: contest.name, description, type: 'website', locale: contest.defaultLocale === 'fr' ? 'fr_CM' : 'en_CM', siteName: 'VOTALLY' } };
}

export default async function ContestPage({ params }: Props) {
  const { slug } = await params;
  const r = await loadContest(slug);
  if (r.kind === 'notfound') notFound();
  if (r.kind === 'private') return <PrivateNotice />;
  return <ContestView {...r.data} base={await linkBase(slug)} />;
}
