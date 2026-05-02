import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Dòng Tiền Nước Ngoài: Mua/Bán Ròng Cổ Phiếu Việt Nam',
    description:
        'Theo dõi giao dịch khối ngoại thực trên cổ phiếu Việt Nam: giá trị mua/bán ròng, biểu đồ khối ngoại trong ngày và top cổ phiếu khối ngoại mua/bán mạnh nhất.',
    keywords: [
        'khối ngoại mua bán ròng',
        'dòng tiền nước ngoài chứng khoán',
        'foreign flow vietnam',
        'foreign investor vietnam stocks',
        'net buy net sell vietnam',
        'khoi ngoai',
        'foreign trading vietnam',
        'foreign investor flow hose',
    ],
    alternates: { canonical: '/foreign' },
    openGraph: {
        title: 'Dòng Tiền Nước Ngoài – Khối Ngoại | Quang Anh',
        description:
            'Top cổ phiếu khối ngoại mua/bán ròng và biểu đồ giao dịch khối ngoại trong ngày trên HOSE.',
        url: '/foreign',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Dòng Tiền Nước Ngoài – Khối Ngoại | Quang Anh',
        description:
            'Giá trị mua/bán ròng khối ngoại và top cổ phiếu khối ngoại giao dịch mạnh nhất hôm nay.',
    },
};

export default function ForeignLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
