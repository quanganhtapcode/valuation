import { createLocalizedMetadata } from '@/lib/i18nRouting';

export const generateMetadata = () => createLocalizedMetadata('/news', {
    vi: { title: 'Tin Tức Chứng Khoán Việt Nam Mới Nhất | HOSE, HNX, UPCOM', description: 'Tin tức doanh nghiệp, kết quả kinh doanh, cổ tức và diễn biến thị trường chứng khoán Việt Nam cập nhật liên tục.' },
    en: { title: 'Latest Vietnam Stock Market News | HOSE, HNX, UPCOM', description: 'Continuously updated Vietnamese market news, corporate disclosures, earnings, dividends, and VNINDEX developments.' },
});

export default function NewsLayout({ children }: { children: React.ReactNode }) { return <>{children}</>; }
