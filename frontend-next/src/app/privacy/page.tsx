import LegalDocument from '@/components/LegalDocument/LegalDocument';
import { createLocalizedMetadata } from '@/lib/i18nRouting';

export const generateMetadata = () => createLocalizedMetadata('/privacy', {
    vi: { title: 'Chính Sách Quyền Riêng Tư', description: 'Cách Quang Anh Stocks xử lý tùy chọn trình duyệt, dữ liệu kỹ thuật và yêu cầu liên quan đến dữ liệu cá nhân.' },
    en: { title: 'Privacy Policy', description: 'How Quang Anh Stocks handles browser preferences, technical information, and personal-data requests.' },
}, { type: 'article' });

export default function PrivacyPage() {
    return <LegalDocument document="privacy" />;
}
