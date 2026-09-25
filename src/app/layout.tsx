import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono, Inter } from 'next/font/google';
import './globals.css';

const sansFont = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  weight: ['400', '500', '600', '700', '800'],
});

const monoFont = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
  weight: ['400', '500', '600'],
});

const interFont = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'BBAS',
    template: '%s · BBAS',
  },
  description: 'Building permission application, scrutiny and approval platform.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sansFont.variable} ${monoFont.variable} ${interFont.variable}`}>
      <body className="min-h-screen font-sans text-body text-text antialiased selection:bg-primary/15 selection:text-primary">
        {children}
      </body>
    </html>
  );
}
