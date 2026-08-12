import AboutContent from './AboutContent';
import { createLocalizedMetadata } from '@/lib/i18nRouting';

/*export const metadata = {
    title: 'Về Chúng Tôi – Nền Tảng Phân Tích Cổ Phiếu Việt Nam',
    description:
        'Quang Anh là nền tảng phân tích và định giá cổ phiếu Việt Nam dành cho nhà đầu tư cá nhân: công cụ DCF, P/E, P/B, lọc cổ phiếu và dữ liệu tài chính 1.700+ cổ phiếu HOSE, HNX, UPCOM.',
    keywords: [
        'về Quang Anh',
        'nền tảng phân tích cổ phiếu',
        'định giá cổ phiếu Việt Nam',
        'about quang anh stocks',
        'vietnam stock analysis platform',
    ],
    alternates: { canonical: '/about' },
    openGraph: {
        title: 'Về Quang Anh – Nền Tảng Phân Tích Cổ Phiếu Việt Nam',
        description:
            'Nền tảng phân tích và định giá cổ phiếu Việt Nam với DCF, P/E, P/B và dữ liệu tài chính cho nhà đầu tư cá nhân.',
        url: '/about',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Về Quang Anh – Nền Tảng Phân Tích Cổ Phiếu Việt Nam',
        description:
            'Công cụ định giá DCF, P/E, P/B và lọc cổ phiếu cho 1.700+ cổ phiếu Việt Nam.',
    },
};*/

export const generateMetadata = () => createLocalizedMetadata('/about', {
    vi: { title: 'Về Quang Anh – Nền Tảng Phân Tích Cổ Phiếu Việt Nam', description: 'Tìm hiểu nền tảng phân tích và định giá cổ phiếu Việt Nam Quang Anh dành cho nhà đầu tư cá nhân.' },
    en: { title: 'About Quang Anh – Vietnam Stock Analysis Platform', description: 'Learn about Quang Anh, a Vietnamese stock analysis and valuation platform built for individual investors.' },
});

export default function AboutPage() {
    return <AboutContent />;
}
