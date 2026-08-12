import { createLocalizedMetadata } from '@/lib/i18nRouting';

export const generateMetadata = () => createLocalizedMetadata('/downloads', {
    vi: { title: 'Tải Dữ Liệu Tài Chính Cổ Phiếu Việt Nam (Excel/CSV)', description: 'Tải báo cáo tài chính và dữ liệu cổ phiếu Việt Nam dạng Excel hoặc CSV theo mã, ngành hoặc toàn thị trường.' },
    en: { title: 'Download Vietnam Stock Financial Data (Excel/CSV)', description: 'Download Vietnamese stock financial statements and market data as Excel or CSV by ticker, industry, or market.' },
});

export default function DownloadsLayout({ children }: { children: React.ReactNode }) { return <>{children}</>; }
