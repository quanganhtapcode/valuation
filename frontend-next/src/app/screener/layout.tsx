import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vietnam Stock Screener: Filter by P/E, P/B, ROE, Growth',
  description:
    'Screen Vietnam stocks with advanced filters for valuation, quality, and growth metrics across HOSE, HNX, and UPCOM.',
  keywords: [
    'vietnam stock screener',
    'hose screener',
    'hnx screener',
    'upcom screener',
    'pe pb roe filter',
  ],
  alternates: { canonical: '/screener' },
  openGraph: {
    title: 'Vietnam Stock Screener | Quang Anh',
    description:
      'Find undervalued Vietnam stocks using filters for P/E, P/B, ROE, market cap, and growth.',
    url: '/screener',
  },
};

export default function ScreenerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

