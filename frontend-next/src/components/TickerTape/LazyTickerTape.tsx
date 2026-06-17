'use client';

import dynamic from 'next/dynamic';

const TickerTape = dynamic(() => import('./TickerTape'), {
  ssr: false,
});

export default function LazyTickerTape() {
  return <TickerTape />;
}
