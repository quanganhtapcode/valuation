import Hero from "@/components/Hero"
import MarketIntelligence from "@/components/MarketIntelligence"
import OverviewGlobeSection from "@/components/OverviewGlobeSection"

import { createLocalizedMetadata } from '@/lib/i18nRouting';

/*export const metadata = {
  title: 'Tổng Quan Thị Trường Chứng Khoán Việt Nam | Phân Tích & Định Giá',
  description:
    'Tổng quan thị trường chứng khoán Việt Nam: công cụ phân tích, theo dõi thị trường, định giá cổ phiếu DCF/P/E/P/B và tin tức đầu tư mới nhất.',
  keywords: [
    'tổng quan thị trường chứng khoán Việt Nam',
    'phân tích chứng khoán Việt Nam',
    'vietnam stock overview',
    'vnindex overview',
    'vietnam market intelligence',
    'vietnam stock valuation',
  ],
  alternates: { canonical: '/overview' },
  openGraph: {
    title: 'Tổng Quan Thị Trường Chứng Khoán Việt Nam | Quang Anh',
    description:
      'Phân tích, định giá và thông tin thị trường chứng khoán Việt Nam trong một nền tảng.',
    url: '/overview',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tổng Quan Thị Trường Chứng Khoán Việt Nam | Quang Anh',
    description:
      'Phân tích, định giá cổ phiếu và tin tức thị trường chứng khoán Việt Nam.',
  },
};*/

export const generateMetadata = () => createLocalizedMetadata('/overview', {
  vi: { title: 'Tổng Quan Thị Trường Chứng Khoán Việt Nam', description: 'Tổng quan công cụ phân tích, định giá DCF/P/E/P/B và dữ liệu thị trường chứng khoán Việt Nam.' },
  en: { title: 'Vietnam Stock Market Overview & Valuation Tools', description: 'Explore Vietnamese market analysis, DCF/P/E/P/B valuation tools, company data, and investor resources.' },
});

export default function OverviewPage() {
    return (
        <main className="flex flex-col gap-24 overflow-hidden pb-24">
            <Hero />
            <MarketIntelligence />
            <OverviewGlobeSection />
        </main>
    )
}
