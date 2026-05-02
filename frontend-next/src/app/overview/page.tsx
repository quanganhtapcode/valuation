import type { Metadata } from 'next';
import Hero from "@/components/Hero"
import MarketIntelligence from "@/components/MarketIntelligence"
import OverviewGlobeSection from "@/components/OverviewGlobeSection"

export const metadata: Metadata = {
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
};

export default function OverviewPage() {
    return (
        <main className="flex flex-col gap-24 overflow-hidden pb-24">
            <Hero />
            <MarketIntelligence />
            <OverviewGlobeSection />
        </main>
    )
}
