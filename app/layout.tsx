import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://agent-sla-aos.aos777aos.chatgpt.site'),
  title: 'AgentSLA — Evidence and GenLayer SLA adjudication',
  description: 'Prepare agent evidence, then read and verify GenLayer consensus verdicts for service-level agreements.',
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
