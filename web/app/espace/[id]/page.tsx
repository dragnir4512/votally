import ContestAdmin from '../../../components/creator/ContestAdmin';

export default async function GestionConcours({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContestAdmin id={id} />;
}
