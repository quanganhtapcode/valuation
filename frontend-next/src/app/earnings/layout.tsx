import { createLocalizedMetadata } from '@/lib/i18nRouting';

export const generateMetadata = () => createLocalizedMetadata('/earnings', {
    vi: { title: 'Doanh Nghiệp Vừa Công Bố Báo Cáo Tài Chính', description: 'Theo dõi doanh thu, lợi nhuận và tăng trưởng của các doanh nghiệp Việt Nam vừa công bố báo cáo tài chính.' },
    en: { title: 'Latest Vietnam Company Earnings Releases', description: 'Track revenue, net income, and growth for Vietnamese listed companies with newly published financial results.' },
});

export default function EarningsLayout({ children }: { children: React.ReactNode }) { return <>{children}</>; }
