import type { Metadata } from 'next';
import Shell from '../../components/creator/Shell';

export const metadata: Metadata = { title: 'Mes concours — VOTALLY', robots: { index: false, follow: false } };
export default function EspaceLayout({ children }: { children: React.ReactNode }) { return <Shell>{children}</Shell>; }
