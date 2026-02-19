import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Manrope } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/layout/providers';

const manrope = Manrope({
  subsets: ['latin'],
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'Connzect',
  description: 'Minimal real-time communication platform.'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={manrope.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
