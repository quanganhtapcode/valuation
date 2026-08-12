import { createLocalizedMetadata } from '@/lib/i18nRouting';

export const generateMetadata = () => createLocalizedMetadata('/screener', {
    vi: { title: 'Lọc Cổ Phiếu Việt Nam: P/E, P/B, ROE, Tăng Trưởng', description: 'Bộ lọc cổ phiếu HOSE, HNX và UPCOM theo P/E, P/B, ROE, biên lợi nhuận, tăng trưởng và vốn hóa.' },
    en: { title: 'Vietnam Stock Screener: P/E, P/B, ROE & Growth', description: 'Screen HOSE, HNX, and UPCOM stocks by valuation, ROE, margins, growth, market capitalization, and more.' },
});

export default function ScreenerLayout({ children }: { children: React.ReactNode }) { return <>{children}</>; }
