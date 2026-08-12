import ContactContent from './ContactContent';
import { createLocalizedMetadata } from '@/lib/i18nRouting';

/*export const metadata = {
    title: 'Liên Hệ – Quang Anh Stocks',
    description:
        'Liên hệ nhóm phát triển Quang Anh để đặt câu hỏi, góp ý tính năng hoặc hợp tác. Email: contact@quanganh.org – SĐT: +84 813 601 054.',
    keywords: [
        'liên hệ Quang Anh',
        'hỗ trợ Quang Anh Stocks',
        'contact quang anh stocks',
        'vietnam stock platform contact',
    ],
    alternates: { canonical: '/contact' },
    openGraph: {
        title: 'Liên Hệ | Quang Anh Stocks',
        description:
            'Liên hệ nhóm Quang Anh qua email contact@quanganh.org hoặc điện thoại +84 813 601 054.',
        url: '/contact',
    },
    twitter: {
        card: 'summary',
        title: 'Liên Hệ | Quang Anh Stocks',
        description:
            'Liên hệ nhóm phát triển Quang Anh để hỗ trợ và hợp tác.',
    },
};*/

export const generateMetadata = () => createLocalizedMetadata('/contact', {
    vi: { title: 'Liên Hệ', description: 'Liên hệ Quang Anh để được hỗ trợ, góp ý tính năng hoặc trao đổi hợp tác.' },
    en: { title: 'Contact', description: 'Contact Quang Anh for support, product feedback, or business collaboration.' },
});

export default function ContactPage() {
    return <ContactContent />;
}
