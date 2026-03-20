import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'News',
  description: 'Latest Vietnam stock market news — continuously updated from listed companies.',
  alternates: { canonical: '/news' },
  openGraph: {
    title: 'Stock Market News | Quang Anh',
    description: 'Latest Vietnam stock market news from listed companies.',
    url: '/news',
  },
};

export default function NewsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
