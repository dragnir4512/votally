import type { Metadata } from 'next';
import Shell from '../../components/creator/Shell';

export const metadata: Metadata = { title: 'Administration — VOTALLY', robots: { index: false, follow: false } };
export default function AdminLayout({ children }: { children: React.ReactNode }) { return <Shell>{children}</Shell>; }
