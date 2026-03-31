import type { Metadata } from 'next';
import Hero from "@/components/Hero"
import MarketIntelligence from "@/components/MarketIntelligence"
import OverviewGlobeSection from "@/components/OverviewGlobeSection"

export const metadata: Metadata = {
  title: 'Vietnam Stock Market Overview',
  description: 'Explore Vietnam stock market overview with analysis tools, market tracking, valuation insights, and latest market intelligence.',
  keywords: ['vietnam stock overview', 'vnindex overview', 'vietnam market intelligence'],
  alternates: { canonical: '/overview' },
  openGraph: {
    title: 'Vietnam Stock Market Overview | Quang Anh',
    description: 'Vietnam stock analysis, valuation, and market intelligence in one place.',
    url: '/overview',
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
