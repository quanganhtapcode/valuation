'use client';

import { isStockDetailPath } from '@/lib/localePath';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

const TickerTape = dynamic(() => import('./TickerTape'), {
  ssr: false,
});

export default function LazyTickerTape() {
  const pathname = usePathname();
  if (isStockDetailPath(pathname)) return null;
  return <TickerTape />;
}
