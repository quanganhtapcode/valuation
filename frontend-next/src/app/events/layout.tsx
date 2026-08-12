import { createLocalizedMetadata } from '@/lib/i18nRouting';

export const generateMetadata = () => createLocalizedMetadata('/events', {
    vi: { title: 'Lịch Sự Kiện Chứng Khoán: Cổ Tức, ĐHCĐ, Giao Dịch Nội Bộ', description: 'Lịch cổ tức, đại hội cổ đông, giao dịch nội bộ và sự kiện của doanh nghiệp niêm yết Việt Nam.' },
    en: { title: 'Vietnam Stock Events: Dividends, AGMs & Insider Trades', description: 'Calendar of dividends, shareholder meetings, insider transactions, and events for Vietnamese listed companies.' },
});

export default function EventsLayout({ children }: { children: React.ReactNode }) { return <>{children}</>; }
