import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AgentSLA — Consensus-ready proof for autonomous work',
  description: 'Bundle agent logs and deliverables into tamper-evident evidence for GenLayer SLA adjudication.',
  openGraph: {
    title: 'AgentSLA — Prove the service. Release the trust.',
    description: 'Portable evidence packs and GenLayer consensus for autonomous service agreements.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'AgentSLA — Prove the service. Release the trust.',
    description: 'Portable evidence packs and GenLayer consensus for autonomous service agreements.',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
