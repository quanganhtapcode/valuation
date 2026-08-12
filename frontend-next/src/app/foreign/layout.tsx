import { createLocalizedMetadata } from '@/lib/i18nRouting';

export const generateMetadata = () => createLocalizedMetadata('/foreign', {
    vi: { title: 'Dòng Tiền Nước Ngoài: Mua/Bán Ròng Cổ Phiếu Việt Nam', description: 'Theo dõi giao dịch khối ngoại, giá trị mua bán ròng trong ngày và các cổ phiếu được khối ngoại giao dịch mạnh nhất.' },
    en: { title: 'Vietnam Foreign Investor Flow: Net Buying & Selling', description: 'Track foreign investor trading, intraday net value, and the Vietnamese stocks with the largest foreign net buying and selling.' },
});

export default function ForeignLayout({ children }: { children: React.ReactNode }) { return <>{children}</>; }
