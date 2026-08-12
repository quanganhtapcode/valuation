import ContactContent from './ContactContent';

export const metadata = {
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
};

export default function ContactPage() {
    return <ContactContent />;
}
