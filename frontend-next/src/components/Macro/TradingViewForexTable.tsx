'use client';

import { createElement, useState } from 'react';
import Script from 'next/script';
import { useTheme } from 'next-themes';
import { useLanguage } from '@/lib/languageContext';

export default function TradingViewForexTable() {
    const { resolvedTheme } = useTheme();
    const { lang } = useLanguage();
    const [failed, setFailed] = useState(false);
    const copy = {
        vi: { label: 'Bảng tỷ giá thế giới TradingView', error: 'Chưa tải được bảng TradingView.', open: 'Xem trên TradingView' },
        en: { label: 'TradingView world exchange rates', error: 'The TradingView table could not load.', open: 'View on TradingView' },
    }[lang];

    return <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" aria-label={copy.label}>
        <Script id="tradingview-forex-table" type="module" src="https://widgets.tradingview-widget.com/w/en/tv-forex-table.js" strategy="afterInteractive" onError={() => setFailed(true)} />
        {failed ? <p role="status" className="px-4 py-8 text-sm text-slate-500">{copy.error} <a href="https://www.tradingview.com/markets/currencies/" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{copy.open}</a></p> :
            createElement('tv-forex-table', {
                theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                style: { display: 'block', width: '100%', height: '360px' },
            })}
    </div>;
}
