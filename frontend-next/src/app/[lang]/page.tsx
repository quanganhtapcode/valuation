import MarketIndices from '@/components/HeroIndexCard/MarketIndices';
import { HeatmapVN30 } from '@/components/HeatmapVN30';
import { NewsPanel, MoversPanel, GoldPanel, PanelSkeleton, OverviewEarnings, OverviewForex, OverviewWatchlist, OverviewWidgets, OverviewPredictions } from './OverviewClient';
import styles from './page.module.css';
import { Suspense } from 'react';
import { getOverviewSnapshots } from '@/lib/overviewSnapshot.server';
import { createLocalizedMetadata, type LocalizedPageProps } from '@/lib/i18nRouting';

// Live updates remain client-side; a bounded snapshot supplies the initial HTML.
export const revalidate = 15;

export const generateMetadata = ({ params }: LocalizedPageProps) => createLocalizedMetadata(params, '/', {
  vi: { title: 'Thị Trường Chứng Khoán Việt Nam Hôm Nay | VNINDEX, VN30', description: 'Theo dõi VNINDEX, VN30, top tăng giảm, heatmap, dòng tiền ngoại, tin tức và định giá cổ phiếu Việt Nam.' },
  en: { title: 'Vietnam Stock Market Today | VNINDEX, VN30 & Analysis', description: 'Track VNINDEX, VN30, top movers, market heatmap, foreign flows, news, and Vietnamese stock valuation.' },
});

type Snapshots = ReturnType<typeof getOverviewSnapshots>;

async function MarketSection({ snapshot }: { snapshot: Snapshots['market'] }) {
  return <MarketIndices {...await snapshot} />;
}

async function HeatmapSection({ snapshot }: { snapshot: Snapshots['heatmap'] }) {
  return <HeatmapVN30 {...await snapshot} />;
}

async function NewsSection({ snapshot }: { snapshot: Snapshots['news'] }) {
  return <NewsPanel {...await snapshot} />;
}

async function MoversSection({ snapshot }: { snapshot: Snapshots['movers'] }) {
  return <MoversPanel {...await snapshot} />;
}

async function GoldSection({ snapshot }: { snapshot: Snapshots['gold'] }) {
  return <GoldPanel {...await snapshot} />;
}

export default function OverviewPage() {
  const snapshots = getOverviewSnapshots();
  return (
    <div className={styles.container}>
      <div className={styles.mainContent}>
        <div className={styles.leftColumn}>
          <Suspense fallback={<PanelSkeleton height="h-[560px]" />}><MarketSection snapshot={snapshots.market} /></Suspense>
          <Suspense fallback={<PanelSkeleton height="h-[650px]" />}><HeatmapSection snapshot={snapshots.heatmap} /></Suspense>
          <OverviewEarnings />
          <div className="order-2">
            <Suspense fallback={<PanelSkeleton height="h-80" />}><NewsSection snapshot={snapshots.news} /></Suspense>
            <OverviewForex />
          </div>
        </div>
        <aside className={styles.rightColumn}>
          <OverviewWatchlist />
          <Suspense fallback={<PanelSkeleton height="h-64" />}><MoversSection snapshot={snapshots.movers} /></Suspense>
          <OverviewWidgets />
          <Suspense fallback={<PanelSkeleton />}><GoldSection snapshot={snapshots.gold} /></Suspense>
          <OverviewPredictions />
          <p className="px-1 text-[11px] leading-relaxed text-justify text-gray-400 dark:text-gray-500">
            Market and company data is aggregated from sources including Vietcap, Yahoo Finance, SBV (State Bank of Vietnam), Polymarket, and other relevant public sources. All data is provided for informational purposes only and is not intended for trading purposes or as financial, investment, tax, legal, accounting, or other professional advice.
          </p>
        </aside>
      </div>
    </div>
  );
}
