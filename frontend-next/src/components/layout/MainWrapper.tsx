'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { isStockDetailPath } from '@/lib/localePath';
import { cancelStockNavigation, completeStockNavigation, getServerStockNavigation,
  getStockNavigation, subscribeStockNavigation } from '@/lib/stockNavigationTransition';
import StockPageShell from '@/components/StockPageShell';
import { usePathname } from 'next/navigation';

export default function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const pending = useSyncExternalStore(subscribeStockNavigation, getStockNavigation, getServerStockNavigation);
  const opening = pending !== null;
  const isStockPage = isStockDetailPath(pathname);
  const paddingClass = isStockPage ? 'pt-[84px]' : 'pt-[116px]';

  useEffect(() => {
    if (!isStockPage) completeStockNavigation(pathname);
  }, [pathname, isStockPage]);
  useEffect(() => {
    window.addEventListener('popstate', cancelStockNavigation);
    return () => window.removeEventListener('popstate', cancelStockNavigation);
  }, []);

  return (
    <main aria-busy={Boolean(opening)} className={`${paddingClass} min-h-[calc(100vh-400px)]`}>
      {opening && <StockPageShell symbol={pending.symbol} lang={pending.lang} />}
      <div hidden={Boolean(opening)} style={opening ? undefined : { display: 'contents' }}>
        {children}
      </div>
    </main>
  );
}
