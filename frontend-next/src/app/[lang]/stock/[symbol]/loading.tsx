'use client';

import { useParams } from 'next/navigation';

/** Cached transition shell: acknowledge the selected ticker before its RSC arrives. */
export default function StockLoading() {
    const params = useParams<{ symbol: string; lang: string }>();
    const symbol = typeof params.symbol === 'string' ? params.symbol.toUpperCase() : '';
    return (
        <div data-stock-loading={symbol} role="status" aria-label={params.lang === 'en' ? 'Loading stock' : 'Đang mở cổ phiếu'}
            className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 sm:px-6">
            <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h1 className="text-xl font-bold tracking-tight text-slate-950 dark:text-white">{symbol}</h1>
                <div aria-hidden="true" className="mt-4 h-12 w-40 animate-pulse rounded bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />
            </section>
            <div aria-hidden="true" className="grid animate-pulse gap-4 motion-reduce:animate-none lg:grid-cols-3">
                <div className="h-96 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:col-span-2" />
                <div className="h-96 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
            </div>
        </div>
    );
}
