import OverviewClient from './OverviewClient';
import { getOverviewSnapshot } from '@/lib/overviewSnapshot.server';
import { createLocalizedMetadata, type LocalizedPageProps } from '@/lib/i18nRouting';

// Live updates remain client-side; a bounded snapshot supplies the initial HTML.
export const revalidate = 15;

export const generateMetadata = ({ params }: LocalizedPageProps) => createLocalizedMetadata(params, '/', {
  vi: { title: 'Thị Trường Chứng Khoán Việt Nam Hôm Nay | VNINDEX, VN30', description: 'Theo dõi VNINDEX, VN30, top tăng giảm, heatmap, dòng tiền ngoại, tin tức và định giá cổ phiếu Việt Nam.' },
  en: { title: 'Vietnam Stock Market Today | VNINDEX, VN30 & Analysis', description: 'Track VNINDEX, VN30, top movers, market heatmap, foreign flows, news, and Vietnamese stock valuation.' },
});

export default async function OverviewPage() {
  const snapshot = await getOverviewSnapshot();
  return <OverviewClient {...snapshot} />;
}
