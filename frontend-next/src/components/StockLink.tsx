'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps } from 'react';
import { prefetchStockData } from '@/lib/stockNavigationData';
import { startStockNavigation } from '@/lib/stockNavigationTransition';

/** Warm one intended destination, without fetching data for entire stock lists. */
export default function StockLink({ symbol, prefetch = false, onMouseEnter, onFocus, onTouchStart, onNavigate, ...props }:
    ComponentProps<typeof Link> & { symbol: string }) {
    const router = useRouter();
    const prepare = () => {
        if (typeof props.href === 'string') router.prefetch(props.href);
        prefetchStockData(symbol);
    };
    return <Link {...props} prefetch={prefetch}
        onNavigate={event => {
            let cancelled = false;
            onNavigate?.({ preventDefault: () => { cancelled = true; event.preventDefault(); } });
            if (!cancelled && typeof props.href === 'string') startStockNavigation(props.href);
        }}
        onMouseEnter={event => { prepare(); onMouseEnter?.(event); }}
        onFocus={event => { prepare(); onFocus?.(event); }}
        onTouchStart={event => { prepare(); onTouchStart?.(event); }} />;
}
