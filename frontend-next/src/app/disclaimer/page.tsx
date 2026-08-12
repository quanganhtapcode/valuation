import LegalDocument from '@/components/LegalDocument/LegalDocument';
import { createLocalizedMetadata } from '@/lib/i18nRouting';

export const generateMetadata = () => createLocalizedMetadata('/disclaimer', {
    vi: { title: 'Tuyên Bố Miễn Trừ Trách Nhiệm', description: 'Giới hạn trách nhiệm khi sử dụng dữ liệu, công cụ định giá và phân tích cổ phiếu trên Quang Anh Stocks.' },
    en: { title: 'Platform Disclaimer', description: 'Important limitations when using market data, valuation tools, and stock analysis on Quang Anh Stocks.' },
}, { type: 'article' });

export default function DisclaimerPage() {
    return <LegalDocument document="disclaimer" />;
}
