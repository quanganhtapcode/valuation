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
  title: 'Thị Trường Chứng Khoán Việt Nam Hôm Nay | VNINDEX, VN30, Cổ Phiếu',
  description:
    'Theo dõi thị trường chứng khoán Việt Nam hôm nay: VNINDEX, VN30 trực tiếp, top tăng/giảm, heatmap, dòng tiền ngoại và công cụ định giá cổ phiếu HOSE, HNX, UPCOM.',
  keywords: [
    'thị trường chứng khoán Việt Nam hôm nay',
    'VNINDEX hôm nay',
    'VN30 hôm nay',
    'cổ phiếu tăng mạnh hôm nay',
    'dòng tiền nước ngoài',
    'vietnam stock market today',
    'vnindex today',
    'vn30 index',
    'hose hnx upcom',
    'vietnam stock news',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Thị Trường Chứng Khoán Việt Nam Hôm Nay | Quang Anh',
    description:
      'Dashboard chứng khoán Việt Nam: VNINDEX/VN30 trực tiếp, top tăng/giảm, heatmap, dòng tiền ngoại và định giá cổ phiếu.',
    url: '/',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Thị Trường Chứng Khoán Việt Nam Hôm Nay | Quang Anh',
    description:
      'VNINDEX/VN30 trực tiếp, top tăng/giảm, heatmap và định giá cổ phiếu Việt Nam.',
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
