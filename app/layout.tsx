import type { Metadata } from 'next';
import './globals.css';

const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  title: 'WEB SHOOTER — Physical Interaction Experience',
  description: '손목 동작으로 화면 속 웹을 발사하는 피지컬 인터랙션 체험',
  ...(siteOrigin ? { metadataBase: new URL(siteOrigin) } : {}),
  openGraph: {
    title: 'WEB SHOOTER',
    description: 'YOUR BODY IS THE CONTROLLER — 손목 동작으로 웹을 발사하는 피지컬 인터랙션 체험',
    type: 'website',
    ...(siteOrigin ? { images: [{ url: '/og.png', width: 1672, height: 941, alt: 'WEB SHOOTER' }] } : {}),
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WEB SHOOTER',
    description: 'YOUR BODY IS THE CONTROLLER',
    ...(siteOrigin ? { images: ['/og.png'] } : {}),
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
