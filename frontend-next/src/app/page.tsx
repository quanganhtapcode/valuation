import { Suspense } from 'react';
import OverviewClient from './OverviewClient';
import {
  INDEX_MAP,
  NewsItem,
  TopMoverItem,
  GoldPriceItem,
  PEChartData,
} from '@/lib/api';

// Force runtime SSR to avoid build-time prerender making network calls.
export const dynamic = 'force-dynamic';

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
    <Suspense fallback={<div className="p-8 text-center text-tremor-content">Loading market data...</div>}>
      <OverviewClient
        initialIndices={initialIndices}
        initialNews={initialNews}
        initialGainers={initialGainers}
        initialLosers={initialLosers}
        initialGoldPrices={initialGoldPrices}
        initialGoldUpdated={initialGoldUpdated}
        initialPEData={initialPEData}
      />
    </Suspense>
  );
}
