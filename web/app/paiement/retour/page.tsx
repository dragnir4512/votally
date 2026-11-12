import { Suspense } from 'react';
import RetourPaiementClient from './RetourPaiementClient';

export default function Page() {
  return (
    <Suspense fallback={<p>Chargement...</p>}>
      <RetourPaiementClient />
    </Suspense>
  );
}
