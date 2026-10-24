'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps } from 'react';
import { prefetchStockData } from '@/lib/stockNavigationData';

/** Warm one intended destination, without fetching data for entire stock lists. */
export default function StockLink({ symbol, prefetch = false, onMouseEnter, onFocus, onTouchStart, ...props }:
    ComponentProps<typeof Link> & { symbol: string }) {
    const router = useRouter();
    const prepare = () => {
        if (typeof props.href === 'string') router.prefetch(props.href);
        prefetchStockData(symbol);
    };
    return <Link {...props} prefetch={prefetch}
        onMouseEnter={event => { prepare(); onMouseEnter?.(event); }}
        onFocus={event => { prepare(); onFocus?.(event); }}
        onTouchStart={event => { prepare(); onTouchStart?.(event); }} />;
}
