'use client';

import Image from 'next/image';
import { useCallback, useState } from 'react';
import MarketChange from './MarketChange';
import SidebarCard from './SidebarCard';
import { OKX_INSTRUMENTS, useOkxTickers } from '@/hooks/useOkxTickers';
import { useVisiblePolling } from '@/hooks/useVisiblePolling';
import { useLanguage } from '@/contexts/LanguageContext';
import { apiUrl } from '@/lib/apiCore';
import { apiFetch } from '@/lib/apiFetch';

const p2pDelay = () => 60_000;
type P2POffer = { price: number; seller: string; completionRate: number; positiveRate: number | null; available: number; orders: number; id: string };
type P2PResult = { offer: P2POffer | null; error: boolean; scanned: number };
type P2PData = { okx: { buy: P2PResult; sell: P2PResult }; binance: { buy: P2PResult; sell: P2PResult }; cashUsd: { buy: number; sell: number } | null; bankUsd: { buy: number; sell: number; date: string; updatedAt: string } | null; fetchedAt: number };

const CRYPTO_LOGOS: Record<string, string> = {
    BTC: '/crypto-logos/btc-551c3d5fe4751a9ca984.svg',
    ETH: '/crypto-logos/eth-4d8017962d675b54dedd.svg',
    SOL: '/crypto-logos/sol-389f478488e06145d48e.svg',
    XRP: '/crypto-logos/xrp-7ef9f0d812984cb142e8.svg',
};

function CryptoLogo({ symbol }: { symbol: string }) {
    const [errored, setErrored] = useState(false);
    const src = CRYPTO_LOGOS[symbol];

    return (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-tremor-border bg-white dark:border-dark-tremor-border">
            {src && !errored ? (
                <Image
                    src={src}
                    alt=""
                    width={36}
                    height={36}
                    unoptimized
                    className={`h-full w-full rounded-full object-contain ${symbol === 'BTC' ? 'p-0.5' : 'p-1.5'}`}
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
    const { lang } = useLanguage();
    const [p2pState, setP2pState] = useState<{ current: P2PData; previous: P2PData | null } | null>(null);
    const p2p = p2pState?.current;
    const refreshP2p = useCallback(async () => {
        try {
            const response = await apiFetch(apiUrl('/market/p2p'), { cache: 'no-store' });
            if (!response.ok) throw new Error('P2P request failed');
            const next: P2PData = await response.json();
            setP2pState(previous => ({ current: next, previous: previous?.current.fetchedAt === next.fetchedAt ? previous.previous : previous?.current ?? null }));
        } catch {
            const failed = { offer: null, error: true, scanned: 0 };
            setP2pState({ current: { okx: { buy: failed, sell: failed }, binance: { buy: failed, sell: failed }, cashUsd: null, bankUsd: null, fetchedAt: Date.now() }, previous: null });
        }
    }, []);
    useVisiblePolling(refreshP2p, p2pDelay);

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
                    <div className="border-t border-gray-100 py-4 dark:border-gray-800/50">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">P2P</span>
                            <span className="text-sm text-gray-400">USD/VND</span>
                        </div>
                        <div className="mt-3 grid grid-cols-[1.3fr_1fr_1fr] gap-2 text-right text-[11px] text-gray-400">
                            <span className="text-left">{lang === 'vi' ? 'Sàn' : 'Exchange'}</span>
                            <span>{lang === 'vi' ? 'Mua' : 'Buy'}</span><span>{lang === 'vi' ? 'Bán' : 'Sell'}</span>
                        </div>
                        {(['okx', 'binance'] as const).map(exchange => <div key={exchange} className="mt-2 grid grid-cols-[1.3fr_1fr_1fr] items-center gap-2 text-sm">
                            <span className="font-medium text-gray-700 dark:text-gray-300">{exchange === 'okx' ? 'OKX' : 'Binance'}</span>
                            {(['buy', 'sell'] as const).map(direction => {
                                const price = p2p?.[exchange][direction].offer?.price;
                                const previousPrice = p2pState?.previous?.[exchange][direction].offer?.price;
                                const change = price !== undefined && previousPrice !== undefined ? Math.sign(price - previousPrice) : 0;
                                return <span key={direction} title={lang === 'vi' ? 'So với lần cập nhật trước' : 'Compared with previous update'} className={`text-right font-semibold tabular-nums ${change > 0 ? 'text-emerald-600 dark:text-emerald-400' : change < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
                                    {change > 0 ? '↑ ' : change < 0 ? '↓ ' : ''}{price?.toLocaleString('vi-VN') ?? '—'}
                                </span>;
                            })}
                        </div>)}
                        <div className="mt-3 grid grid-cols-[1.3fr_1fr_1fr] items-center gap-2 border-t border-gray-100 pt-3 text-sm dark:border-gray-800/50">
                            <a href="https://www.vietcombank.com.vn/vi-VN/KHCN/Cong-cu-tien-ich/Ty-gia" target="_blank" rel="noopener noreferrer" title={p2p?.bankUsd ? `${lang === 'vi' ? 'Tiền mặt, tỷ giá ngày' : 'Cash rate dated'} ${p2p.bankUsd.date}` : (lang === 'vi' ? 'Tỷ giá tiền mặt' : 'Cash rate')} className="font-medium text-gray-700 hover:underline dark:text-gray-300">Vietcombank</a>
                            {(['buy', 'sell'] as const).map(direction => {
                                const price = p2p?.bankUsd?.[direction];
                                const previousPrice = p2pState?.previous?.bankUsd?.[direction];
                                const change = price !== undefined && previousPrice !== undefined ? Math.sign(price - previousPrice) : 0;
                                return <span key={direction} title={lang === 'vi' ? 'So với lần cập nhật trước' : 'Compared with previous update'} className={`text-right font-semibold tabular-nums ${change > 0 ? 'text-emerald-600 dark:text-emerald-400' : change < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>{change > 0 ? '↑ ' : change < 0 ? '↓ ' : ''}{price?.toLocaleString('vi-VN') ?? '—'}</span>;
                            })}
                        </div>
                        <div className="mt-2 grid grid-cols-[1.3fr_1fr_1fr] items-center gap-2 text-sm">
                            <a href="https://chogia.vn/ngoai-te/usd-cho-den/" target="_blank" rel="noopener noreferrer" className="font-medium text-gray-700 hover:underline dark:text-gray-300">{lang === 'vi' ? 'USD tự do' : 'Cash USD'}</a>
                            {(['buy', 'sell'] as const).map(direction => {
                                const price = p2p?.cashUsd?.[direction];
                                const previousPrice = p2pState?.previous?.cashUsd?.[direction];
                                const change = price !== undefined && previousPrice !== undefined ? Math.sign(price - previousPrice) : 0;
                                return <span key={direction} title={lang === 'vi' ? 'So với lần cập nhật trước' : 'Compared with previous update'} className={`text-right font-semibold tabular-nums ${change > 0 ? 'text-emerald-600 dark:text-emerald-400' : change < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>{change > 0 ? '↑ ' : change < 0 ? '↓ ' : ''}{price?.toLocaleString('vi-VN') ?? '—'}</span>;
                            })}
                        </div>
                        <div className="mt-4 space-y-2 rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-gray-800/50">
                            {([['okx', 'binance'], ['binance', 'okx']] as const).map(([buyExchange, sellExchange]) => {
                                const buy = p2p?.[buyExchange].buy.offer;
                                const sell = p2p?.[sellExchange].sell.offer;
                                const gap = buy && sell ? sell.price - buy.price : null;
                                return <div key={buyExchange} className="flex items-center justify-between gap-2 text-xs">
                                    <span className="text-gray-500 dark:text-gray-400">{buyExchange === 'okx' ? 'OKX' : 'Binance'} → {sellExchange === 'okx' ? 'OKX' : 'Binance'}</span>
                                    <span className={`font-semibold tabular-nums ${gap !== null && gap > 0 ? 'text-emerald-600 dark:text-emerald-400' : gap !== null && gap < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}>{gap !== null && buy ? `${gap > 0 ? '+' : ''}${gap.toLocaleString('vi-VN')} ₫ (${gap > 0 ? '+' : ''}${(gap / buy.price * 100).toFixed(2)}%)` : '—'}</span>
                                </div>;
                            })}
                        </div>

                    </div>
                </div>
            </div>
        </SidebarCard>
    );
}
