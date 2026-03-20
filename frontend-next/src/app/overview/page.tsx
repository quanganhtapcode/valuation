import type { Metadata } from 'next';
import Hero from "@/components/Hero"
import MarketIntelligence from "@/components/MarketIntelligence"
import OverviewGlobeSection from "@/components/OverviewGlobeSection"

export const metadata: Metadata = {
  title: 'Overview',
  description: 'Explore Quang Anh — stock analysis, market tracking, DCF valuation and Vietnam stock market news.',
  alternates: { canonical: '/overview' },
  openGraph: {
    title: 'Overview | Quang Anh',
    description: 'Vietnam stock analysis and valuation platform.',
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
