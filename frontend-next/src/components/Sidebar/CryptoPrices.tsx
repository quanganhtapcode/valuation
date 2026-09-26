'use client';

import MarketChange from './MarketChange';
import SidebarCard from './SidebarCard';
import { OKX_INSTRUMENTS, useOkxTickers } from '@/lib/useOkxTickers';

function formatPrice(symbol: string, price: number): string {
    const decimals = symbol === 'BTC' ? 2 : 4;
    return price.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
    });
}

export default function CryptoPrices() {
    const { data, status } = useOkxTickers();

    return (
        <SidebarCard
            title="Crypto (OKX)"
            icon="🪙"
            status={status === 'connecting' ? '...' : status === 'disconnected' ? 'Reconnecting' : undefined}
        >
            <div className="px-5 pb-2">
                <div className="flex flex-col">
                    {OKX_INSTRUMENTS.map((it) => {
                        const st = data[it.instId];
                        const last = st?.last;
                        const pct = st?.changePct24h;
                        return (
                            <div
                                key={it.instId}
                                className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-800/50 last:border-0"
                            >
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{it.label}/USDT</span>

                                <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                                        {typeof last === 'number' ? formatPrice(it.label, last) : '—'}
                                    </span>
                                    <MarketChange value={pct} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </SidebarCard>
    );
}
