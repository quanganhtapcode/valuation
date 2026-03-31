import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vietnam Stock Market News',
  description: 'Latest Vietnam stock market news and company updates, continuously refreshed for investors and researchers.',
  keywords: ['vietnam stock news', 'vnindex news', 'hose news', 'hnx news', 'upcom news'],
  alternates: { canonical: '/news' },
  openGraph: {
    title: 'Vietnam Stock Market News | Quang Anh',
    description: 'Latest Vietnam stock market news from listed companies and market sources.',
    url: '/news',
  },
};

export default function NewsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
