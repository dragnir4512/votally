import ContestSectionPage from '../../../components/ContestSectionPage';

type Props = { params: Promise<{ slug: string }> };

export default async function Page({ params }: Props) {
  const { slug } = await params;
  return <ContestSectionPage slug={slug} section="ranking" />;
}
