import OverviewClient from './OverviewClient';
import { createLocalizedMetadata } from '@/lib/i18nRouting';
import {
  NewsItem,
  TopMoverItem,
  GoldPriceItem,
} from '@/lib/api';

// The overview shell is static; live market data is loaded client-side.
export const revalidate = 300;

export const generateMetadata = () => createLocalizedMetadata('/', {
  vi: { title: 'Thị Trường Chứng Khoán Việt Nam Hôm Nay | VNINDEX, VN30', description: 'Theo dõi VNINDEX, VN30, top tăng giảm, heatmap, dòng tiền ngoại, tin tức và định giá cổ phiếu Việt Nam.' },
  en: { title: 'Vietnam Stock Market Today | VNINDEX, VN30 & Analysis', description: 'Track VNINDEX, VN30, top movers, market heatmap, foreign flows, news, and Vietnamese stock valuation.' },
});

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

  return (
    <OverviewClient
      initialIndices={initialIndices}
      initialNews={initialNews}
      initialGainers={initialGainers}
      initialLosers={initialLosers}
      initialGoldPrices={initialGoldPrices}
      initialGoldUpdated={initialGoldUpdated}
    />
  );
}
