import type { Metadata } from 'next';
import OverviewClient from './OverviewClient';
import {
  NewsItem,
  TopMoverItem,
  GoldPriceItem,
  PEChartData,
} from '@/lib/api';

// Force runtime SSR to avoid build-time prerender making network calls.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Vietnam Stock Market Today, VNINDEX, VN30, News & Valuation',
  description:
    'Track Vietnam stock market today with live VNINDEX/VN30 data, top movers, heatmap, foreign flows, and valuation tools for HOSE, HNX, and UPCOM stocks.',
  keywords: [
    'vietnam stock',
    'vietnam stock market today',
    'vnindex today',
    'vn30 index',
    'hose hnx upcom',
    'vietnam stock news',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Vietnam Stock Market Today | Quang Anh',
    description:
      'Live Vietnam stock market dashboard with VNINDEX, VN30, top movers, heatmap, and stock insights.',
    url: '/',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vietnam Stock Market Today | Quang Anh',
    description:
      'Live VNINDEX/VN30, top movers, heatmap, and valuation insights for Vietnam stocks.',
  },
};

interface IndexData {
  id: string;
  name: string;
  value: number;
  change: number;
  percentChange: number;
  chartData: number[];
  advances: number | undefined;
  declines: number | undefined;
  noChanges: number | undefined;
  ceilings: number | undefined;
  floors: number | undefined;
  totalShares: number | undefined;
  totalValue: number | undefined;
}

export default async function OverviewPage() {
  // WS-first mode: do not prefetch indices over HTTP on SSR.
  // Client subscribes to /ws/market/indices and only falls back to /market/vci-indices on WS error/close.
  const initialIndices: IndexData[] = [];

  // Defer non-critical sections to client-side fetching for faster first paint
  const initialNews: NewsItem[] = [];
  const initialGainers: TopMoverItem[] = [];
  const initialLosers: TopMoverItem[] = [];
  const initialGoldPrices: GoldPriceItem[] = [];
  const initialGoldUpdated: undefined = undefined;
  const initialPEData: PEChartData[] = [];

  return (
    <OverviewClient
      initialIndices={initialIndices}
      initialNews={initialNews}
      initialGainers={initialGainers}
      initialLosers={initialLosers}
      initialGoldPrices={initialGoldPrices}
      initialGoldUpdated={initialGoldUpdated}
      initialPEData={initialPEData}
    />
  );
}
