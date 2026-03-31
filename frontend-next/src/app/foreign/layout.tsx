import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Foreign Investor Flow: Net Buy/Sell in Vietnam Stocks',
    description: 'Track real-time foreign investor trading in Vietnam stocks with net buy/sell value and intraday volume trends.',
    keywords: ['foreign flow vietnam', 'foreign investor vietnam stocks', 'net buy net sell vietnam', 'khoi ngoai'],
    alternates: { canonical: '/foreign' },
    openGraph: {
        title: 'Foreign Investor Flow | Quang Anh',
        description: 'Top foreign net buy/sell stocks and intraday cumulative foreign trading charts.',
        url: '/foreign',
    },
};

export default function ForeignLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
