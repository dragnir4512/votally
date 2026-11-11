import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VOTALLY — Concours de vote en ligne',
  description: 'Crée et gère tes concours de vote en ligne. Paiement Mobile Money, résultats transparents.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#D71920' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="fr"><body>{children}</body></html>;
}
