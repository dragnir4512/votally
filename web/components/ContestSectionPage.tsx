import { notFound } from 'next/navigation';
import ContestView, { type PublicSection } from './ContestView';
import PrivateNotice from './PrivateNotice';
import { linkBase, loadContest } from '../lib/server-api';

export default async function ContestSectionPage({ slug, section }: { slug: string; section: PublicSection }) {
  const result = await loadContest(slug);
  if (result.kind === 'notfound') notFound();
  if (result.kind === 'private') return <PrivateNotice />;
  return <ContestView {...result.data} base={await linkBase(slug)} section={section} />;
}
