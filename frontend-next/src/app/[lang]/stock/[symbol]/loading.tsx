'use client';

import { useParams } from 'next/navigation';
import StockPageShell from '@/components/StockPageShell';

export default function StockLoading() {
    const params = useParams<{ symbol: string; lang: string }>();
    const symbol = typeof params.symbol === 'string' ? params.symbol.toUpperCase() : '';
    return <StockPageShell symbol={symbol} lang={params.lang === 'en' ? 'en' : 'vi'} />;
}
