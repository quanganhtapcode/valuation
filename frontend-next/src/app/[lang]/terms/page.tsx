import LegalDocument from '@/components/LegalDocument/LegalDocument';
import { createLocalizedMetadata, type LocalizedPageProps } from '@/lib/i18nRouting';

export const generateMetadata = ({ params }: LocalizedPageProps) => createLocalizedMetadata(params, '/terms', {
    vi: { title: 'Điều Khoản Sử Dụng', description: 'Quyền, nghĩa vụ và giới hạn khi sử dụng nền tảng phân tích và dữ liệu chứng khoán Quang Anh Stocks.' },
    en: { title: 'Terms of Service', description: 'Rights, responsibilities, and limits when using the Quang Anh Stocks analysis and market-data platform.' },
}, { type: 'article' });

export default function TermsPage() {
    return <LegalDocument document="terms" />;
}
