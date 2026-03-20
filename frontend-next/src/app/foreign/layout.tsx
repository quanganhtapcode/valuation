import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Khối Ngoại',
    description: 'Giao dịch khối ngoại theo thời gian thực — mua/bán ròng, khối lượng và giá trị lũy kế trong phiên.',
    alternates: { canonical: '/foreign' },
    openGraph: {
        title: 'Giao Dịch Khối Ngoại | Quang Anh',
        description: 'Top mua bán khối ngoại và biểu đồ khối lượng giao dịch trong phiên.',
        url: '/foreign',
    },
};

export default function ForeignLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
