'use client';

import Image from 'next/image';
import { useState } from 'react';
import MarketChange from './MarketChange';
import SidebarCard from './SidebarCard';
import { OKX_INSTRUMENTS, useOkxTickers } from '@/hooks/useOkxTickers';

const CRYPTO_LOGOS: Record<string, string> = {
    BTC: '/crypto-logos/btc-93c3748eaa15f82e15b1.png',
    ETH: '/crypto-logos/eth-149976b3ecbd4793a9ff.png',
    SOL: '/crypto-logos/sol-61d04e9c09fbc7f92124.png',
    XRP: '/crypto-logos/xrp-b77cd0140985d622ca5b.png',
};

function CryptoLogo({ symbol }: { symbol: string }) {
    const [errored, setErrored] = useState(false);
    const src = CRYPTO_LOGOS[symbol];

    return (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-tremor-border bg-white dark:border-dark-tremor-border dark:bg-gray-800">
            {src && !errored ? (
                <Image
                    src={src}
                    alt=""
                    width={36}
                    height={36}
                    unoptimized
                    className="h-full w-full object-contain p-0.5"
                    onError={() => setErrored(true)}
                />
            ) : (
                <span className="text-[9px] font-bold text-tremor-content dark:text-dark-tremor-content">{symbol.slice(0, 2)}</span>
            )}
        </span>
    );
}

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
            status={status === 'connecting' ? '...' : status === 'disconnected' ? 'Reconnecting' : undefined}
        >
            <div className="px-4 pb-2">
                <div className="flex flex-col">
                    {OKX_INSTRUMENTS.map((it) => {
                        const st = data[it.instId];
                        const last = st?.last;
                        const pct = st?.changePct24h;
                        return (
                            <div
                                key={it.instId}
                                className="flex items-center justify-between gap-2 py-3 border-b border-gray-100 dark:border-gray-800/50 last:border-0"
                            >
                                <div className="flex min-w-0 items-center gap-2">
                                    <CryptoLogo symbol={it.label} />
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{it.label}/USDT</span>
                                </div>

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
