import { createLocalizedMetadata } from '@/lib/i18nRouting';

export const generateMetadata = () => createLocalizedMetadata('/macro', {
    vi: { title: 'Kinh Tế Vĩ Mô Việt Nam: Tỷ Giá, CPI, GDP, Hàng Hóa', description: 'Theo dõi tỷ giá USD/VND, CPI, GDP, lãi suất, vàng và hàng hóa ảnh hưởng đến thị trường chứng khoán Việt Nam.' },
    en: { title: 'Vietnam Macro Data: FX, CPI, GDP & Commodities', description: 'Track USD/VND, inflation, GDP, interest rates, gold, and commodities affecting the Vietnamese stock market.' },
});

export default function MacroLayout({ children }: { children: React.ReactNode }) { return <>{children}</>; }
