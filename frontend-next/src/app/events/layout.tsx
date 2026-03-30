import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vietnam Stock Events Calendar',
  description:
    'Corporate events calendar for Vietnamese stocks: dividends, AGMs, insider trading, and other corporate actions. Filter by date and category.',
  keywords: ['vietnam stock events', 'dividend calendar', 'agm calendar', 'insider trading vietnam'],
  alternates: { canonical: '/events' },
  openGraph: {
    title: 'Stock Events Calendar | Quang Anh',
    description: 'Daily corporate events for Vietnam stocks: dividends, AGMs, insider trades.',
    url: '/events',
  },
};

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
