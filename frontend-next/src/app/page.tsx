import OverviewClient from './OverviewClient';
import { getOverviewSnapshot } from '@/lib/overviewSnapshot.server';
import { createLocalizedMetadata } from '@/lib/i18nRouting';
import {
  NewsItem,
  TopMoverItem,
  GoldPriceItem,
} from '@/lib/api';

// Live updates remain client-side; a bounded snapshot supplies the initial HTML.
export const revalidate = 300;

export const generateMetadata = () => createLocalizedMetadata('/', {
  vi: { title: 'Thị Trường Chứng Khoán Việt Nam Hôm Nay | VNINDEX, VN30', description: 'Theo dõi VNINDEX, VN30, top tăng giảm, heatmap, dòng tiền ngoại, tin tức và định giá cổ phiếu Việt Nam.' },
  en: { title: 'Vietnam Stock Market Today | VNINDEX, VN30 & Analysis', description: 'Track VNINDEX, VN30, top movers, market heatmap, foreign flows, news, and Vietnamese stock valuation.' },
});

export default async function OverviewPage() {
  const initialIndices = await getOverviewSnapshot();

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
