'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { API } from '@/lib/api';
import { getFFWS, FFPrice } from '@/lib/ffWS';
import { useLanguage } from '@/lib/languageContext';
import {
    FF_ALL_INDEX_CHANNELS,
    FF_AMERICAS_CHANNELS,
    FF_ASIA_CHANNELS,
    FF_EUROPE_CHANNELS,
    FF_FOREX_CHANNELS,
    RANGE_OPTIONS,
    RATES_REFRESH_MS,
    TV_CONFIGS,
    VIETNAM_SUBTABS,
    VIETNAM_TAB_TV,
    fmtUsdChange,
    fmtUsdPrice,
    fmtVndChange,
    fmtVndPrice,
    getMarketSessions,
    type FFCardDef,
    type PricePoint,
    type RateItem,
    type RatesData,
    type VietnamSubTabId,
} from './config';

const AreaChart = dynamic(() => import('@tremor/react').then((module) => module.AreaChart), {
    ssr: false,
    loading: () => <div className="h-48 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />,
});

// Keep one in-memory request per symbol/range for the summary cards.
const historyRequestCache = new Map<string, Promise<PricePoint[]>>();

const MACRO_LABELS_EN: Record<string, string> = {
    'ECONOMICS:VNINBR': 'Overnight interbank rate', 'ECONOMICS:VNINTR': 'Policy interest rate', 'ECONOMICS:VNDIR': 'Deposit interest rate',
    'ECONOMICS:VNGDPYY': 'GDP growth (YoY)', 'ECONOMICS:VNGDPCP': 'Real GDP (quarterly)', 'ECONOMICS:VNGDPS': 'GDP – services',
    'ECONOMICS:VNGDPMAN': 'GDP – industry', 'ECONOMICS:VNGDPA': 'GDP – agriculture', 'ECONOMICS:VNGDPPC': 'GDP per capita',
    'ECONOMICS:VNGNP': 'GNP', 'ECONOMICS:VNGFCF': 'Fixed asset investment', 'ECONOMICS:VNIRYY': 'Inflation (YoY)',
    'ECONOMICS:VNCPI': 'Consumer price index (CPI)', 'ECONOMICS:VNFI': 'Food inflation', 'ECONOMICS:VNCIR': 'Core inflation',
    'ECONOMICS:VNGASP': 'Fuel price', 'ECONOMICS:VNFER': 'Foreign exchange reserves', 'ECONOMICS:VNM2': 'Money supply M2',
    'ECONOMICS:VNEXP': 'Exports', 'ECONOMICS:VNIMP': 'Imports', 'ECONOMICS:VNBOT': 'Trade balance',
    'ECONOMICS:VNFDI': 'Foreign direct investment (FDI)', 'ECONOMICS:VNUR': 'Unemployment rate', 'ECONOMICS:VNWAG': 'Average wage',
    'ECONOMICS:VNMW': 'Minimum wage', 'ECONOMICS:VNPOP': 'Population', 'ECONOMICS:VNIPYY': 'Industrial production (YoY)',
    'ECONOMICS:VNRSYY': 'Retail sales (YoY)',
};

function macroLabel(symbol: string, vietnamese: string, lang: 'vi' | 'en') {
    return lang === 'en' ? (MACRO_LABELS_EN[symbol] ?? vietnamese) : vietnamese;
}

function macroUnit(unit: string, lang: 'vi' | 'en') {
    if (lang === 'vi') return unit;
    return unit.replaceAll('nghìn tỷ', 'trillion').replaceAll('tỷ', 'bil').replaceAll('triệu', 'million').replaceAll('người', 'people').replaceAll('năm', 'year').replaceAll('tháng', 'month').replaceAll('₫', 'VND');
}

function loadMacroHistory(symbol: string, days: number): Promise<PricePoint[]> {
    const cacheKey = `${symbol}:${days}`;
    const cached = historyRequestCache.get(cacheKey);
    if (cached) return cached;

    const request = fetch(API.MACRO_HISTORY(symbol, days))
        .then((response) => response.ok ? response.json() : [])
        .catch(() => [] as PricePoint[]);
    historyRequestCache.set(cacheKey, request);
    return request;
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
    return <div className="h-[100px] rounded-lg animate-pulse bg-slate-100 dark:bg-slate-800" />;
}
function Spinner({ h = 'h-48' }: { h?: string }) {
    return (
        <div className={`${h} flex items-center justify-center`}>
            <div className="w-5 h-5 border-2 border-slate-300 dark:border-slate-700 border-t-slate-600 dark:border-t-slate-300 rounded-full animate-spin" />
        </div>
    );
}
function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>{children}</div>;
}
function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
    return (
        <div className="mb-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
        </div>
    );
}

// ── History chart for exchange rates / commodities ────────────────────────────

function downloadCsv(filename: string, rows: PricePoint[]) {
    const body = rows.map((r) => `${r.date},${r.close}`).join('\n');
    const blob  = new Blob([`Date,Close\n${body}`], { type: 'text/csv;charset=utf-8;' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

function HistoryChart({ item, isVnd, onClose }: { item: RateItem; isVnd: boolean; onClose: () => void }) {
    const [days, setDays]       = useState(365);
    const [points, setPoints]   = useState<PricePoint[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async (d: number) => {
        setLoading(true);
        try {
            setPoints(await loadMacroHistory(item.symbol, d));
        } catch { /* ignore */ }
        finally { setLoading(false); }
    }, [item.symbol]);

    useEffect(() => { load(days); }, [days, load]);

    const first = points[0]?.close ?? null;
    const last  = points[points.length - 1]?.close ?? null;
    const overallChange = first && last ? ((last - first) / first) * 100 : null;
    const up = overallChange === null ? true : overallChange >= 0;

    const useDayFormat = days <= 180;
    const chartData = points.map((p) => {
        const [y, m, d] = p.date.split('-');
        return {
            Ngày: useDayFormat ? `${d}/${m}` : `${m}/${y.slice(2)}`,
            [item.name]: p.close,
        };
    });

    const fmtY = isVnd ? fmtVndPrice : fmtUsdPrice;
    const maxClose = points.length ? Math.max(...points.map((p) => p.close)) : 0;
    const yAxisW   = isVnd ? 80 : maxClose >= 1000 ? 70 : 52;
    const rangeLabel = RANGE_OPTIONS.find((o) => o.days === days)?.label ?? '';

    return (
        <div>
            <Panel className="p-5">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <p className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                            {item.name}
                            {item.unit && <span className="ml-1.5 text-xs font-normal text-tremor-content dark:text-dark-tremor-content">({item.unit})</span>}
                        </p>
                        {overallChange !== null && (
                            <p className={`text-sm mt-0.5 font-medium ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {up ? '▲' : '▼'} {Math.abs(overallChange).toFixed(2)}% trong kỳ
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 text-xs">
                            {RANGE_OPTIONS.map((opt) => (
                                <button key={opt.days} onClick={() => setDays(opt.days)}
                                    className={`px-2.5 py-1 font-medium transition-colors ${days === opt.days ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        {points.length > 0 && (
                            <button onClick={() => downloadCsv(`${item.symbol.replace('=', '_')}_${rangeLabel}.csv`, points)}
                                title="Tải CSV"
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                    <path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                                CSV
                            </button>
                        )}
                        <button onClick={onClose} className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" aria-label="Đóng">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                            </svg>
                        </button>
                    </div>
                </div>
                {loading ? <Spinner h="h-48" /> : chartData.length === 0
                    ? <div className="h-48 flex items-center justify-center text-sm text-tremor-content dark:text-dark-tremor-content">Không có dữ liệu</div>
                    : <AreaChart data={chartData} index="Ngày" categories={[item.name]}
                        colors={[up ? 'emerald' : 'rose']} valueFormatter={fmtY}
                        yAxisWidth={yAxisW} showLegend={false} showGradient autoMinValue
                        showAnimation={false} tickGap={60} className="h-48" />}
            </Panel>
        </div>
    );
}

function SessionBadge({ open, tz }: { open: boolean; tz: string }) {
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
            open
                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
        }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${open ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            {open ? 'Đang mở' : 'Đóng cửa'} · {tz}
        </span>
    );
}

function FFLiveCard({ def, snap }: { def: FFCardDef; snap: FFPrice | undefined }) {
    const up        = (snap?.changePercent ?? 0) >= 0;
    const colorCls  = up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
    const bgCls     = up ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-rose-50 dark:bg-rose-900/20';
    return (
        <div className="rounded-tremor-default ring-1 ring-tremor-ring dark:ring-dark-tremor-ring bg-tremor-background dark:bg-dark-tremor-background p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-tremor-content dark:text-dark-tremor-content mb-1">{def.label}</p>
            {snap ? (
                <>
                    <p className="text-2xl font-bold tabular-nums text-tremor-content-strong dark:text-dark-tremor-content-strong">{def.fmt(snap.price)}</p>
                    <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${bgCls} ${colorCls}`}>
                        <span>{up ? '▲' : '▼'}</span>
                        <span>{Math.abs(snap.changePercent).toFixed(2)}%</span>
                    </div>
                    <p className="mt-1.5 text-[10px] text-slate-400 dark:text-slate-500">Live · Forex Factory</p>
                </>
            ) : (
                <div className="space-y-2 mt-1">
                    <div className="h-7 w-28 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                    <div className="h-4 w-16 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
                </div>
            )}
        </div>
    );
}

function MarketSnapshotTable({ items, snapshots }: { items: readonly FFCardDef[]; snapshots: Map<string, FFPrice> }) {
    const { lang } = useLanguage();
    const marketFlag = (channel: string) => channel.startsWith('Nikkei') ? '🇯🇵' : channel.startsWith('KOSPI') ? '🇰🇷' : channel.startsWith('ASX') ? '🇦🇺' : channel.startsWith('DAX') ? '🇩🇪' : channel.startsWith('FTSE') ? '🇬🇧' : channel.startsWith('CAC') || channel.startsWith('STOXX') ? '🇪🇺' : '🇺🇸';
    return (
        <div className="overflow-x-auto border-y border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-300">
                    <tr><th className="px-2 py-3 md:px-4">{lang === 'vi' ? 'Tên' : 'Name'}</th><th className="px-2 py-3 text-right md:px-4">{lang === 'vi' ? 'Lần cuối' : 'Last'}</th><th className="hidden px-2 py-3 text-right sm:table-cell md:px-4">{lang === 'vi' ? 'Mở cửa' : 'Open'}</th><th className="px-2 py-3 text-right md:px-4">{lang === 'vi' ? 'T. đổi' : 'Change'}</th><th className="px-2 py-3 text-right md:px-4">{lang === 'vi' ? '% T. đổi' : '% change'}</th><th className="px-2 py-3 text-right md:px-4">{lang === 'vi' ? 'Thời gian' : 'Status'}</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {items.map((item) => {
                        const snap = snapshots.get(item.channel);
                        const change = snap ? snap.price - snap.dayOpen : null;
                        const up = (snap?.changePercent ?? 0) >= 0;
                        return <tr key={item.channel} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"><td className="px-2 py-3.5 font-semibold text-slate-900 md:px-4 dark:text-slate-100"><span className="mr-3">{marketFlag(item.channel)}</span>{item.label}</td><td className="px-2 py-3.5 text-right font-medium tabular-nums md:px-4">{snap ? item.fmt(snap.price) : <span className="inline-block h-4 w-16 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />}</td><td className="hidden px-2 py-3.5 text-right tabular-nums sm:table-cell md:px-4">{snap ? item.fmt(snap.dayOpen) : '—'}</td><td className={`px-2 py-3.5 text-right font-semibold tabular-nums md:px-4 ${up ? 'text-emerald-600' : 'text-rose-600'}`}>{change === null ? '—' : `${change >= 0 ? '+' : ''}${item.fmt(change)}`}</td><td className={`px-2 py-3.5 text-right font-semibold tabular-nums md:px-4 ${up ? 'text-emerald-600' : 'text-rose-600'}`}>{snap ? `${snap.changePercent >= 0 ? '+' : ''}${snap.changePercent.toFixed(2)}%` : '—'}</td><td className="px-2 py-3.5 text-right md:px-4"><span className={`inline-flex items-center gap-1.5 text-xs font-medium ${snap ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}><span className={`h-1.5 w-1.5 rounded-full ${snap ? 'bg-emerald-500' : 'bg-slate-300'}`} /><span className="hidden sm:inline">{snap ? (lang === 'vi' ? 'Trực tiếp' : 'Live') : (lang === 'vi' ? 'Đang kết nối' : 'Connecting')}</span></span></td></tr>;
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ── Rate Card ─────────────────────────────────────────────────────────────────

function RateCard({ item, isVnd, selected, onClick }: { item: RateItem; isVnd: boolean; selected: boolean; onClick: () => void }) {
    const up        = item.changePercent >= 0;
    const colorCls  = up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
    const bgCls     = up ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-rose-50 dark:bg-rose-900/20';
    return (
        <button onClick={onClick}
            className={`text-left rounded-tremor-default ring-1 transition-all duration-150 focus:outline-none
                ${selected ? 'ring-blue-500 shadow-md shadow-blue-500/10' : 'ring-tremor-ring dark:ring-dark-tremor-ring hover:ring-blue-400 hover:shadow-sm'}
                bg-tremor-background dark:bg-dark-tremor-background p-4 w-full`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-tremor-content dark:text-dark-tremor-content mb-1">{item.name}</p>
            <p className="text-2xl font-bold tabular-nums text-tremor-content-strong dark:text-dark-tremor-content-strong">
                {isVnd ? fmtVndPrice(item.price) : fmtUsdPrice(item.price)}
            </p>
            {item.unit && <p className="text-[11px] text-tremor-content dark:text-dark-tremor-content mt-0.5">{item.unit}</p>}
            <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${bgCls} ${colorCls}`}>
                <span>{up ? '▲' : '▼'}</span>
                <span>{Math.abs(item.changePercent).toFixed(2)}%</span>
                <span className="opacity-70">({isVnd ? fmtVndChange(item.change) : fmtUsdChange(item.change)})</span>
            </div>
            <p className="mt-2 text-[10px] text-blue-500 dark:text-blue-400 font-medium">
                {selected ? '▴ Thu gọn' : '▾ Xem lịch sử'}
            </p>
        </button>
    );
}

function CardGrid({ items, isVnd }: { items: RateItem[]; isVnd: boolean }) {
    const [selected, setSelected] = useState<string | null>(null);
    const selectedItem = items.find((i) => i.symbol === selected) ?? null;
    const toggle = (sym: string) => setSelected((prev) => (prev === sym ? null : sym));
    return (
        <div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {items.map((item) => (
                    <RateCard key={item.symbol} item={item} isVnd={isVnd}
                        selected={selected === item.symbol} onClick={() => toggle(item.symbol)} />
                ))}
            </div>
            {selectedItem && (
                <div className="mt-4">
                    <HistoryChart key={selectedItem.symbol} item={selectedItem}
                        isVnd={isVnd} onClose={() => setSelected(null)} />
                </div>
            )}
        </div>
    );
}

function getDeltaDirection(delta: number | null) {
    if (delta === null) return 'flat';
    if (delta > 0) return 'up';
    if (delta < 0) return 'down';
    return 'flat';
}

function formatComparisonText(delta: number | null, label: string, unitLabel: string, formatter: (v: number) => string) {
    if (delta === null) return 'Chưa đủ dữ liệu so sánh';
    const abs = Math.abs(delta);
    if (unitLabel.includes('%')) return `${delta >= 0 ? '+' : '-'}${abs.toFixed(2)} điểm so với ${label}`;
    return `${delta >= 0 ? '+' : '-'}${formatter(abs)} so với ${label}`;
}

function buildTvSummary(sym: string, points: PricePoint[]) {
    const cfg = TV_CONFIGS[sym];
    const latest = points.at(-1)?.close ?? null;
    const compareLag = cfg.compareLag ?? (cfg.freq === 'annual' ? 1 : cfg.freq === 'daily' ? 1 : 12);
    const comparePoint = points.length > compareLag ? points.at(-(compareLag + 1))?.close ?? null : null;
    const delta = latest !== null && comparePoint !== null ? latest - comparePoint : null;
    return {
        latest,
        updatedAt: points.at(-1)?.date ?? null,
        delta,
        comparisonText: formatComparisonText(delta, cfg.compareLabel ?? 'kỳ trước', cfg.unitLabel, cfg.fmt),
        comparisonLabel: cfg.compareLabel ?? 'kỳ trước',
    };
}

function VietnamTvRow({ sym }: { sym: string }) {
    const { lang } = useLanguage();
    const cfg = TV_CONFIGS[sym];
    const [points, setPoints] = useState<PricePoint[] | null>(null);
    useEffect(() => {
        let active = true;
        loadMacroHistory(sym, cfg.defaultDays).then(data => { if (active) setPoints(data); }).catch(() => { if (active) setPoints([]); });
        return () => { active = false; };
    }, [cfg.defaultDays, sym]);
    if (!points) return <tr><td colSpan={5} className="px-4 py-4"><div className="h-4 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" /></td></tr>;
    const summary = buildTvSummary(sym, points);
    const tone = getDeltaDirection(summary.delta);
    const toneClass = tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-rose-600' : 'text-slate-500';
    return <tr className="border-b border-slate-100 dark:border-slate-800"><td className="px-3 py-3.5 md:px-4"><p className="font-semibold">{macroLabel(sym, cfg.titleVN, lang)}</p><p className="mt-0.5 text-xs text-slate-500">{macroUnit(cfg.unitLabel, lang)}</p></td><td className="px-3 py-3.5 text-right font-medium tabular-nums md:px-4">{summary.latest === null ? '—' : cfg.fmt(summary.latest)}</td><td className={`px-3 py-3.5 text-right font-semibold tabular-nums md:px-4 ${toneClass}`}>{summary.delta === null ? '—' : `${summary.delta >= 0 ? '+' : ''}${cfg.fmt(summary.delta)}`}</td><td className={`hidden px-3 py-3.5 text-right text-sm font-semibold sm:table-cell md:px-4 ${toneClass}`}>{summary.comparisonLabel}</td><td className="px-3 py-3.5 text-right text-sm text-slate-500 md:px-4">{summary.updatedAt ?? '—'}</td></tr>;
}

function VietnamMacroTab() {
    const { lang } = useLanguage();
    const [activeSubTab, setActiveSubTab] = useState<VietnamSubTabId>('growth');

    return (
        <div className="space-y-5">
            <section>
                <SectionHeader title={lang === 'vi' ? 'Chỉ số kinh tế Việt Nam' : 'Vietnam economic indicators'} subtitle={VIETNAM_SUBTABS.find((tab) => tab.id === activeSubTab)?.subtitle ?? ''} />
                <div className="flex flex-wrap gap-2">
                    {VIETNAM_SUBTABS.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => {
                                setActiveSubTab(tab.id);
                            }}
                            className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                                activeSubTab === tab.id
                                    ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                                    : 'border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 hover:border-blue-300 dark:hover:border-blue-700'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="mt-5 overflow-x-auto border-y border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><table className="min-w-full text-left text-sm"><thead className="border-b border-slate-200 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-300"><tr><th className="px-3 py-3 md:px-4">Chỉ số</th><th className="px-3 py-3 text-right md:px-4">Lần cuối</th><th className="px-3 py-3 text-right md:px-4">T. đổi</th><th className="hidden px-3 py-3 text-right sm:table-cell md:px-4">So sánh</th><th className="px-3 py-3 text-right md:px-4">Thời gian</th></tr></thead><tbody>{VIETNAM_TAB_TV[activeSubTab].map(sym => <VietnamTvRow key={sym} sym={sym} />)}</tbody></table></div>
            </section>
        </div>
    );
}

// ── World Tab — isolated component so WS subs don't affect Vietnam tab ────────

function WorldTab() {
    const { lang } = useLanguage();
    const [view, setView]           = useState<'indices' | 'fx' | 'commodities'>('indices');
    const [region, setRegion]       = useState<'asia' | 'europe' | 'americas'>('asia');
    const [rates, setRates]         = useState<RatesData | null>(null);
    const [ratesLoading, setRL]     = useState(true);
    const [ffForex, setFfForex]     = useState<Map<string, FFPrice>>(new Map());
    const [ffIndices, setFfIndices] = useState<Map<string, FFPrice>>(new Map());

    const loadRates = useCallback(async () => {
        try { const r = await fetch(API.MACRO_RATES); if (r.ok) setRates(await r.json()); }
        catch { /* ignore */ } finally { setRL(false); }
    }, []);

    useEffect(() => {
        if (view === 'indices') return;
        loadRates();
        const t = setInterval(loadRates, RATES_REFRESH_MS);

        return () => clearInterval(t);
    }, [loadRates, view]);

    useEffect(() => {
        const ws = getFFWS();
        const forexUnsubs   = FF_FOREX_CHANNELS.map(def =>
            ws.subscribe(def.channel, (snap: FFPrice) => setFfForex(prev => new Map(prev).set(def.channel, snap)))
        );
        const indicesUnsubs = FF_ALL_INDEX_CHANNELS.map(def =>
            ws.subscribe(def.channel, (snap: FFPrice) => setFfIndices(prev => new Map(prev).set(def.channel, snap)))
        );

        return () => {
            [...forexUnsubs, ...indicesUnsubs].forEach(fn => fn());
        };
    }, []);

    const fxRates     = rates?.exchange_rates ?? [];
    const commodities = rates?.commodities    ?? [];
    const sess        = getMarketSessions();
    const regionItems = region === 'asia' ? FF_ASIA_CHANNELS : region === 'europe' ? FF_EUROPE_CHANNELS : FF_AMERICAS_CHANNELS;
    const regionalCopy = region === 'asia'
        ? { title: lang === 'vi' ? 'Châu Á - Thái Bình Dương' : 'Asia-Pacific', hours: 'Tokyo 7:00–13:30 · Sydney 7:00–13:00', open: sess.asia, tz: '07:00–13:30' }
        : region === 'europe'
            ? { title: lang === 'vi' ? 'Châu Âu' : 'Europe', hours: 'Frankfurt/London 14:00–22:30', open: sess.europe, tz: '14:00–22:30' }
            : { title: lang === 'vi' ? 'Châu Mỹ' : 'Americas', hours: 'NYSE/NASDAQ 20:30–03:00', open: sess.americas, tz: '20:30–03:00' };

    return (
        <div className="space-y-6">
            <div className="border-b border-slate-200 dark:border-slate-800">
                <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label={lang === 'vi' ? 'Dữ liệu thị trường toàn cầu' : 'Global market data'}>
                    {([['indices', lang === 'vi' ? 'Chỉ số' : 'Indices'], ['fx', lang === 'vi' ? 'Tiền tệ' : 'Currencies'], ['commodities', lang === 'vi' ? 'Hàng hóa' : 'Commodities']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-semibold ${view === id ? 'border-blue-600 text-blue-700 dark:text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'}`}>{label}</button>)}
                </div>
            </div>

            {view === 'indices' && <section>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><SectionHeader title={regionalCopy.title} subtitle={`${regionalCopy.hours} · ${lang === 'vi' ? 'giờ Việt Nam' : 'Vietnam time'}`} /><SessionBadge open={regionalCopy.open} tz={regionalCopy.tz} /></div>
                <div className="mb-4 flex flex-wrap gap-2">{([['asia', lang === 'vi' ? 'Châu Á - Thái Bình Dương' : 'Asia-Pacific'], ['europe', lang === 'vi' ? 'Châu Âu' : 'Europe'], ['americas', lang === 'vi' ? 'Châu Mỹ' : 'Americas']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setRegion(id)} className={`rounded-full border px-4 py-2 text-sm font-semibold ${region === id ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300' : 'border-slate-200 text-slate-600 dark:border-slate-800 dark:text-slate-300'}`}>{label}</button>)}</div>
                <MarketSnapshotTable items={regionItems} snapshots={ffIndices} />
            </section>}

            {/* VND Exchange Rates */}
            {view === 'fx' && <><section>
                <SectionHeader title={lang === 'vi' ? 'Tỷ Giá Hối Đoái VND' : 'VND exchange rates'} subtitle={lang === 'vi' ? 'VND so với các đồng tiền chính' : 'VND against major currencies'} />
                {ratesLoading
                    ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
                    : fxRates.length === 0
                    ? <p className="text-sm text-slate-500 py-6">{lang === 'vi' ? 'Không lấy được dữ liệu tỷ giá.' : 'Exchange-rate data is unavailable.'}</p>
                    : <CardGrid items={fxRates} isVnd={true} />}
            </section>

            {/* Forex */}
            <section>
                <SectionHeader title={lang === 'vi' ? 'Ngoại Hối Quốc Tế' : 'Global foreign exchange'} subtitle={lang === 'vi' ? 'Các cặp tiền tệ chính' : 'Major currency pairs'} />
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
                    {FF_FOREX_CHANNELS.map(def => (
                        <FFLiveCard key={def.channel} def={def} snap={ffForex.get(def.channel)} />
                    ))}
                </div>
            </section></>}

            {/* Commodities */}
            {view === 'commodities' && <section>
                <SectionHeader title={lang === 'vi' ? 'Hàng Hóa Quốc Tế' : 'Global commodities'} subtitle={lang === 'vi' ? 'Nguồn Yahoo Finance · chỉ tải khi mở nhóm này' : 'Yahoo Finance · loaded only when this group is opened'} />
                {ratesLoading
                    ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
                    : commodities.length === 0
                    ? <p className="text-sm text-slate-500 py-6">{lang === 'vi' ? 'Không lấy được dữ liệu hàng hóa.' : 'Commodity data is unavailable.'}</p>
                    : <CardGrid items={commodities} isVnd={false} />}
            </section>}
        </div>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type TabId = 'vietnam' | 'world';

export default function MacroPage() {
    const { lang } = useLanguage();
    const [activeTab, setActiveTab] = useState<TabId>('vietnam');
    const tabs: Array<{ id: TabId; label: string }> = lang === 'vi'
        ? [{ id: 'vietnam', label: 'Việt Nam' }, { id: 'world', label: 'Thế Giới' }]
        : [{ id: 'vietnam', label: 'Vietnam' }, { id: 'world', label: 'Global' }];

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
                <header className="mb-5">
                    <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100 md:text-4xl">
                        {lang === 'vi' ? 'Thị trường ' : 'Macro '}
                        <span className="text-emerald-600 dark:text-emerald-400">{lang === 'vi' ? 'vĩ mô' : 'markets'}</span>
                    </h1>
                    <div className="mt-2 h-1 w-32 rounded bg-emerald-500" />
                    <p className="mt-3 max-w-4xl text-sm text-slate-600 dark:text-slate-300 md:text-base">{lang === 'vi' ? 'Theo dõi chỉ số kinh tế Việt Nam và thị trường quốc tế.' : 'Follow Vietnamese economic indicators and global markets.'}</p>
                    <div className="mt-5 flex overflow-x-auto border-b border-slate-200 dark:border-slate-800">
                        {tabs.map(tab => (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                                className={`shrink-0 border-b-2 px-5 py-3 text-base font-semibold transition-colors
                                    ${activeTab === tab.id
                                        ? 'border-blue-600 text-blue-700 dark:text-blue-400'
                                        : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'}`}>
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </header>

                {/* ── Vietnam Tab ── */}
                {activeTab === 'vietnam' && <VietnamMacroTab />}

                {/* ── World Tab ── */}
                {activeTab === 'world' && <WorldTab />}

            </div>
        </div>
    );
}
