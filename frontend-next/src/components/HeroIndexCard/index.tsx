'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    createChart,
    IChartApi,
    ISeriesApi,
    AreaSeries,
    LineSeries,
    HistogramSeries,
    UTCTime,
    CrosshairMode,
    MouseEventParams,
} from 'lightweight-charts';
import { API_BASE, INDEX_MAP, fetchPEChartByRange, PEChartData, ValuationStats } from '@/lib/api';
import { cx } from '@/lib/utils';
import { RiHistoryLine } from '@remixicon/react';
import IndexHistoryModal from '@/components/IndexCard/IndexHistoryModal';

// ── Types ─────────────────────────────────────────────────────────────────────

interface IndexData {
    id: string;
    name: string;
    value: number;
    change: number;
    percentChange: number;
    advances?: number;
    declines?: number;
    noChanges?: number;
    ceilings?: number;
    floors?: number;
    totalShares?: number;
    totalValue?: number;
}

interface HeroIndexCardProps {
    indices: IndexData[];
}

type Range = '3M' | '6M' | '1Y' | 'MAX';

interface SimpleBar { date: string; close: number; volume: number }

// ── Constants ─────────────────────────────────────────────────────────────────

const INDEX_TABS = [
    { id: 'vnindex', label: 'VN-Index' },
    { id: 'vn30',    label: 'VN30'     },
    { id: 'hnx',     label: 'HNX'      },
    { id: 'upcom',   label: 'UPCOM'    },
];

const PE_COLOR  = '#818cf8';
const PB_COLOR  = '#34d399';
const AREA_COLOR = '#0E6BFF';

// ── Helpers ───────────────────────────────────────────────────────────────────

function cutoffISO(range: Range): string | null {
    if (range === 'MAX') return null;
    const months = { '3M': 3, '6M': 6, '1Y': 12 }[range];
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
}

function dateToISO(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function toUTCTime(iso: string): UTCTime {
    const [y, m, day] = iso.split('-').map(Number);
    return { year: y, month: m, day };
}

function fmtDate(t: UTCTime): string {
    return `${String(t.day).padStart(2, '0')}/${String(t.month).padStart(2, '0')}/${t.year}`;
}

function dayKey(t: UTCTime): string {
    return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

function fmtVol(v: number): string {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}K`;
    return String(v);
}

function fmtVal(n: number): string {
    const ty = n / 1000;
    return ty >= 1000 ? `${(ty / 1000).toFixed(2)} N.Tỷ` : `${ty.toFixed(2)} Tỷ`;
}

function toNum(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') { const p = Number(v); return Number.isFinite(p) ? p : null; }
    return null;
}

function buildTheme(isDark: boolean) {
    return {
        isDark,
        text:          isDark ? '#9ca3af' : '#6b7280',
        border:        isDark ? '#1f2937' : '#e5e7eb',
        crosshair:     isDark ? '#4b5563' : '#d1d5db',
        gridLine:      isDark ? 'rgba(55,65,81,0.3)' : 'rgba(229,231,235,0.6)',
        tooltipBg:     isDark ? 'rgba(15,23,42,0.97)' : 'rgba(255,255,255,0.97)',
        tooltipBorder: isDark ? '#334155' : '#e2e8f0',
        tooltipText:   isDark ? '#e2e8f0' : '#0f172a',
        tooltipMuted:  isDark ? '#64748b' : '#94a3b8',
    };
}

function useDarkMode(): boolean {
    const [isDark, setIsDark] = useState<boolean>(() =>
        typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
    );
    useEffect(() => {
        const obs = new MutationObserver(() =>
            setIsDark(document.documentElement.classList.contains('dark')),
        );
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
    }, []);
    return isDark;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PctChip({ pct, large = false }: { pct: number; large?: boolean }) {
    const up = pct >= 0;
    return (
        <span className={cx(
            'inline-flex items-center gap-1 rounded-md font-semibold tabular-nums whitespace-nowrap',
            large ? 'px-2 py-1 text-[13px]' : 'px-1.5 py-0.5 text-[11px]',
            up  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                : 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400',
        )}>
            <svg width={large ? 9 : 7} height={large ? 9 : 7} viewBox="0 0 10 10">
                <path d={up ? 'M5 1 L9 8 L1 8 Z' : 'M5 9 L1 2 L9 2 Z'} fill="currentColor" />
            </svg>
            {up ? '+' : ''}{pct.toFixed(2)}%
        </span>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HeroIndexCard({ indices }: HeroIndexCardProps) {
    const isDark = useDarkMode();
    const theme  = useMemo(() => buildTheme(isDark), [isDark]);

    // ── UI state ──────────────────────────────────────────────────────────────
    const [selectedId, setSelectedId] = useState('vnindex');
    const [range,      setRange]      = useState<Range>('1Y');
    const [showPE,     setShowPE]     = useState(false);
    const [showPB,     setShowPB]     = useState(false);
    const [modalOpen,  setModalOpen]  = useState(false);

    // ── Data state ────────────────────────────────────────────────────────────
    const [vnRows,   setVnRows]   = useState<PEChartData[]>([]);
    const [vnStats,  setVnStats]  = useState<{ pe?: ValuationStats; pb?: ValuationStats }>({});
    const [vnLoad,   setVnLoad]   = useState(false);
    const [idxBars,  setIdxBars]  = useState<SimpleBar[]>([]);
    const [idxLoad,  setIdxLoad]  = useState(false);
    const idxCache = useRef<Map<string, SimpleBar[]>>(new Map());

    // ── Chart refs ────────────────────────────────────────────────────────────
    const wrapRef   = useRef<HTMLDivElement>(null);
    const chartRef  = useRef<IChartApi | null>(null);
    const areaRef   = useRef<ISeriesApi<'Area'> | null>(null);
    const volRef    = useRef<ISeriesApi<'Histogram'> | null>(null);
    const peRef     = useRef<ISeriesApi<'Line'> | null>(null);
    const pbRef     = useRef<ISeriesApi<'Line'> | null>(null);
    const closeMap  = useRef<Map<string, number>>(new Map());
    const [tooltip, setTooltip]       = useState<any>(null);
    const [cw,      setContainerW]    = useState(800);
    const [ch,      setContainerH]    = useState(380);

    const isVN     = selectedId === 'vnindex';
    const selected = indices.find(i => i.id === selectedId) || indices[0];

    // ── Fetch VN-Index full history once ──────────────────────────────────────
    useEffect(() => {
        if (vnRows.length > 0) return;
        setVnLoad(true);
        fetchPEChartByRange('ALL', 'both')
            .then(r => { setVnRows(r.series); setVnStats(r.stats); })
            .catch(console.error)
            .finally(() => setVnLoad(false));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Fetch other indices on demand ─────────────────────────────────────────
    useEffect(() => {
        if (isVN) return;
        const info = Object.values(INDEX_MAP).find(i => i.id === selectedId);
        if (!info) return;

        const cached = idxCache.current.get(selectedId);
        if (cached) { setIdxBars(cached); return; }

        setIdxLoad(true);
        setIdxBars([]);
        fetch(`${API_BASE}/market/index-history?index=${info.vciSymbol}&days=2500`)
            .then(r => r.json())
            .then((rows: any[]) => {
                if (!Array.isArray(rows)) return;
                const bars = rows
                    .filter(r => r.tradingDate && r.closeIndex)
                    .map(r => ({
                        date:   String(r.tradingDate).slice(0, 10),
                        close:  Number(r.closeIndex),
                        volume: Number(r.totalVolume || r.totalMatchVolume || 0),
                    }))
                    .sort((a, b) => a.date.localeCompare(b.date));
                idxCache.current.set(selectedId, bars);
                setIdxBars(bars);
            })
            .catch(console.error)
            .finally(() => setIdxLoad(false));
    }, [selectedId, isVN]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Derive chart series from data + range ─────────────────────────────────
    const cutoff = cutoffISO(range);

    const priceTV = useMemo(() => {
        if (isVN) {
            return vnRows
                .filter(d => d.vnindex !== null && (!cutoff || dateToISO(d.date) >= cutoff))
                .map(d => ({ time: toUTCTime(dateToISO(d.date)), value: d.vnindex!, volume: d.volume ?? 0 }));
        }
        return idxBars
            .filter(d => !cutoff || d.date >= cutoff)
            .map(d => ({ time: toUTCTime(d.date), value: d.close, volume: d.volume }));
    }, [isVN, vnRows, idxBars, cutoff]);

    const peTV = useMemo(() =>
        vnRows
            .filter(d => d.pe !== null && (!cutoff || dateToISO(d.date) >= cutoff))
            .map(d => ({ time: toUTCTime(dateToISO(d.date)), value: d.pe! })),
        [vnRows, cutoff],
    );

    const pbTV = useMemo(() =>
        vnRows
            .filter(d => d.pb !== null && (!cutoff || dateToISO(d.date) >= cutoff))
            .map(d => ({ time: toUTCTime(dateToISO(d.date)), value: d.pb! })),
        [vnRows, cutoff],
    );

    // Latest stats for header display
    const latestVN = useMemo(() => {
        const last = [...vnRows].reverse().find(d => d.vnindex !== null);
        return last ?? null;
    }, [vnRows]);

    // ── Chart initialisation (once) ───────────────────────────────────────────
    useEffect(() => {
        if (!wrapRef.current || chartRef.current) return;

        const t0 = buildTheme(document.documentElement.classList.contains('dark'));
        const chart = createChart(wrapRef.current, {
            width:  wrapRef.current.clientWidth,
            height: ch,
            layout: {
                background:  { type: 'solid', color: 'transparent' },
                textColor:   t0.text,
                fontSize:    11,
                fontFamily:  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            },
            grid: {
                vertLines: { color: t0.gridLine },
                horzLines: { color: t0.gridLine },
            },
            crosshair: {
                mode:     CrosshairMode.Normal,
                vertLine: { color: t0.crosshair, width: 1, style: 2, labelBackgroundColor: AREA_COLOR },
                horzLine: { color: t0.crosshair, width: 1, style: 2, labelBackgroundColor: AREA_COLOR },
            },
            rightPriceScale: {
                borderColor:    t0.border,
                scaleMargins:   { top: 0.08, bottom: 0.25 },
                entireTextOnly: true,
            },
            leftPriceScale: {
                visible:      false,
                borderColor:  t0.border,
                scaleMargins: { top: 0.1, bottom: 0.1 },
                entireTextOnly: true,
            },
            timeScale: {
                borderColor:           t0.border,
                timeVisible:           false,
                rightOffset:           5,
                barSpacing:            6,
                rightBarStaysOnScroll: true,
            },
            handleScroll: { vertTouchDrag: false },
            handleScale:  { axisPressedMouseMove: { time: true, price: true } },
        });

        const area = chart.addSeries(AreaSeries, {
            topColor:                       `${AREA_COLOR}38`,
            bottomColor:                    `${AREA_COLOR}03`,
            lineColor:                      AREA_COLOR,
            lineWidth:                      2,
            lineType:                       2,
            crosshairMarkerRadius:          4,
            crosshairMarkerBackgroundColor: AREA_COLOR,
            crosshairMarkerBorderColor:     '#ffffff',
            crosshairMarkerBorderWidth:     2,
            priceLineVisible:               false,
            lastValueVisible:               true,
        });

        const vol = chart.addSeries(HistogramSeries, {
            priceFormat:      { type: 'volume' },
            priceScaleId:     '',
            // @ts-ignore — scaleMargins works at runtime in lightweight-charts v5
            scaleMargins:     { top: 0.90, bottom: 0 },
            priceLineVisible: false,
            lastValueVisible: false,
        });

        const pe = chart.addSeries(LineSeries, {
            visible:                        false,
            color:                          PE_COLOR,
            lineWidth:                      1,
            priceScaleId:                   'left',
            crosshairMarkerRadius:          3,
            crosshairMarkerBackgroundColor: PE_COLOR,
            crosshairMarkerBorderColor:     '#ffffff',
            crosshairMarkerBorderWidth:     1,
            priceLineVisible:               false,
            lastValueVisible:               true,
        });

        const pb = chart.addSeries(LineSeries, {
            visible:                        false,
            color:                          PB_COLOR,
            lineWidth:                      1,
            priceScaleId:                   'left',
            crosshairMarkerRadius:          3,
            crosshairMarkerBackgroundColor: PB_COLOR,
            crosshairMarkerBorderColor:     '#ffffff',
            crosshairMarkerBorderWidth:     1,
            priceLineVisible:               false,
            lastValueVisible:               true,
        });

        chart.subscribeCrosshairMove((param: MouseEventParams) => {
            if (!param?.time || !param?.seriesData) { setTooltip(null); return; }
            const areaVal = param.seriesData.get(area);
            if (!areaVal) { setTooltip(null); return; }

            const close  = areaVal.value as number;
            const volVal = param.seriesData.get(vol);
            const peVal  = param.seriesData.get(pe);
            const pbVal  = param.seriesData.get(pb);
            const t      = param.time as UTCTime;
            const k      = dayKey(t);
            const keys   = Array.from(closeMap.current.keys());
            const idx    = keys.indexOf(k);
            let change   = '';
            if (idx > 0) {
                const prev = closeMap.current.get(keys[idx - 1]) ?? 0;
                const ch   = close - prev;
                const pct  = prev > 0 ? (ch / prev) * 100 : 0;
                change = `${ch >= 0 ? '+' : ''}${Math.abs(ch).toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
            }

            setTooltip({
                time:   fmtDate(t),
                close:  close.toLocaleString('en-US', { maximumFractionDigits: 2 }),
                change,
                volume: fmtVol((volVal?.value as number) ?? 0),
                pe:     peVal ? ((peVal.value as number).toFixed(2) + 'x') : null,
                pb:     pbVal ? ((pbVal.value as number).toFixed(2) + 'x') : null,
                x: param.point?.x ?? 0,
                y: param.point?.y ?? 0,
            });
        });

        chartRef.current = chart;
        areaRef.current  = area;
        volRef.current   = vol;
        peRef.current    = pe;
        pbRef.current    = pb;

        const ro = new ResizeObserver(([e]) => {
            const w = e.contentRect.width;
            const h = w < 640 ? 300 : 380;
            setContainerW(w || 800);
            setContainerH(h);
            chart.applyOptions({ width: w, height: h });
        });
        ro.observe(wrapRef.current);

        return () => {
            ro.disconnect();
            chart.remove();
            chartRef.current = areaRef.current = volRef.current = peRef.current = pbRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Sync theme ────────────────────────────────────────────────────────────
    useEffect(() => {
        chartRef.current?.applyOptions({
            layout:          { textColor: theme.text },
            grid:            { vertLines: { color: theme.gridLine }, horzLines: { color: theme.gridLine } },
            rightPriceScale: { borderColor: theme.border },
            leftPriceScale:  { borderColor: theme.border },
            timeScale:       { borderColor: theme.border },
            crosshair:       { vertLine: { color: theme.crosshair }, horzLine: { color: theme.crosshair } },
        });
    }, [theme]);

    // ── Push price data ───────────────────────────────────────────────────────
    useEffect(() => {
        if (!areaRef.current || !volRef.current || !priceTV.length) return;
        areaRef.current.setData(priceTV.map(d => ({ time: d.time, value: d.value })));
        closeMap.current = new Map(priceTV.map(d => [dayKey(d.time), d.value]));
        volRef.current.setData(priceTV.map((d, i) => ({
            time:  d.time,
            value: d.volume,
            color: i === 0 || d.value >= priceTV[i - 1].value
                ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
        })));
        chartRef.current?.timeScale().fitContent();
    }, [priceTV]);

    // ── Push PE/PB data ───────────────────────────────────────────────────────
    useEffect(() => {
        if (!peRef.current || !peTV.length) return;
        peRef.current.setData(peTV);
    }, [peTV]);

    useEffect(() => {
        if (!pbRef.current || !pbTV.length) return;
        pbRef.current.setData(pbTV);
    }, [pbTV]);

    // ── PE/PB overlay visibility ──────────────────────────────────────────────
    useEffect(() => {
        if (!peRef.current || !pbRef.current || !chartRef.current) return;
        const hasOverlay = (showPE || showPB) && isVN;
        peRef.current.applyOptions({ visible: showPE && isVN });
        pbRef.current.applyOptions({ visible: showPB && isVN });
        chartRef.current.applyOptions({ leftPriceScale: { visible: hasOverlay } });
        setTooltip(null);
    }, [showPE, showPB, isVN]);

    // ── On index switch: hide overlays if leaving VN-Index ────────────────────
    useEffect(() => {
        if (!chartRef.current) return;
        chartRef.current.timeScale().fitContent();
        if (!isVN) {
            peRef.current?.applyOptions({ visible: false });
            pbRef.current?.applyOptions({ visible: false });
            chartRef.current.applyOptions({ leftPriceScale: { visible: false } });
        }
        setTooltip(null);
    }, [isVN, selectedId]);

    // ── Fit on range change ───────────────────────────────────────────────────
    useEffect(() => { chartRef.current?.timeScale().fitContent(); }, [range]);

    // ── Render ────────────────────────────────────────────────────────────────
    const isUp      = (selected?.change ?? 0) >= 0;
    const isLoading = isVN ? vnLoad : idxLoad;

    return (
        <>
            {/* ── Index sub-bar ── */}
            <div className="flex items-stretch overflow-x-auto bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800/60 rounded-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {INDEX_TABS.map(tab => {
                    const idx    = indices.find(i => i.id === tab.id);
                    const active = tab.id === selectedId;
                    const up     = (idx?.change ?? 0) >= 0;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setSelectedId(tab.id)}
                            className={cx(
                                'flex items-center gap-2.5 px-4 h-11 border-r border-gray-100 dark:border-gray-800/60 flex-shrink-0 cursor-pointer transition-colors last:border-r-0',
                                active
                                    ? 'border-b-2 border-b-blue-500 -mb-[1px]'
                                    : 'border-b-2 border-b-transparent hover:bg-gray-50 dark:hover:bg-gray-800/40',
                            )}
                        >
                            <span className={cx('text-xs font-semibold whitespace-nowrap', active ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500')}>
                                {tab.label}
                            </span>
                            {idx && idx.value > 0 && (
                                <>
                                    <span className={cx('text-xs font-medium tabular-nums', active ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500')}>
                                        {idx.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                                    </span>
                                    <span className={cx('text-[11px] font-semibold tabular-nums', up ? 'text-emerald-500' : 'text-red-500')}>
                                        {up ? '+' : ''}{idx.percentChange.toFixed(2)}%
                                    </span>
                                </>
                            )}
                        </button>
                    );
                })}
                <div className="flex-1" />
                <div className="flex items-center gap-1.5 px-4 text-[11px] text-gray-400 whitespace-nowrap flex-shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                    LIVE
                </div>
            </div>

            {/* ── Hero card ── */}
            <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800/60 rounded-xl overflow-hidden">

                {/* Stats header */}
                <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-0">

                    {/* Left: price + KPIs */}
                    <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-gray-400 dark:text-gray-500">
                            {selected?.name || '—'}
                        </div>

                        {selected && selected.value > 0 ? (
                            <>
                                <div className="flex items-baseline gap-3 mt-2 flex-wrap">
                                    <span className={cx(
                                        'text-[44px] font-semibold tabular-nums leading-none tracking-tight',
                                        isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                                    )}>
                                        {selected.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <span className={cx('font-semibold tabular-nums text-sm', isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                                            {isUp ? '+' : ''}{selected.change.toFixed(2)}
                                        </span>
                                        <PctChip pct={selected.percentChange} large />
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-5 mt-3">
                                    {!!selected.totalShares && (
                                        <Stat label="VOL" value={selected.totalShares.toLocaleString('en-US')} />
                                    )}
                                    {!!selected.totalValue && (
                                        <Stat label="VAL" value={fmtVal(selected.totalValue)} />
                                    )}
                                    {selected.advances !== undefined && (
                                        <Stat label="ADV" value={String(selected.advances)} color="text-emerald-600 dark:text-emerald-400"
                                            suffix={selected.ceilings ? `(${selected.ceilings})` : undefined} suffixColor="text-violet-500" />
                                    )}
                                    {selected.noChanges !== undefined && (
                                        <Stat label="UNCH" value={String(selected.noChanges)} color="text-amber-500" />
                                    )}
                                    {selected.declines !== undefined && (
                                        <Stat label="DEC" value={String(selected.declines)} color="text-red-600 dark:text-red-400"
                                            suffix={selected.floors ? `(${selected.floors})` : undefined} suffixColor="text-cyan-500" />
                                    )}
                                    {isVN && latestVN?.pe !== null && latestVN?.pe !== undefined && (
                                        <Stat label="P/E" value={`${latestVN.pe.toFixed(2)}x`} color="text-indigo-500 dark:text-indigo-400" labelColor="text-indigo-400" />
                                    )}
                                    {isVN && latestVN?.pb !== null && latestVN?.pb !== undefined && (
                                        <Stat label="P/B" value={`${latestVN.pb.toFixed(2)}x`} color="text-emerald-500 dark:text-emerald-400" labelColor="text-emerald-400" />
                                    )}
                                </div>
                            </>
                        ) : (
                            <SkeletonStats />
                        )}
                    </div>

                    {/* Right: controls */}
                    <div className="flex flex-col gap-2 items-end flex-shrink-0 pt-1">
                        {/* Range selector */}
                        <div className="flex p-0.5 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700/60 rounded-lg">
                            {(['3M', '6M', '1Y', 'MAX'] as Range[]).map(r => (
                                <button key={r} onClick={() => setRange(r)}
                                    className={cx(
                                        'px-2.5 py-1.5 rounded-md text-[11px] font-medium tabular-nums transition-all cursor-pointer',
                                        range === r
                                            ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                                            : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300',
                                    )}>
                                    {r}
                                </button>
                            ))}
                        </div>

                        {/* PE / PB toggles (VN-Index only) + History */}
                        <div className="flex gap-1.5">
                            {isVN && (
                                <>
                                    <ToggleBtn active={showPE} color="indigo" label="P/E" onClick={() => setShowPE(v => !v)} />
                                    <ToggleBtn active={showPB} color="emerald" label="P/B" onClick={() => setShowPB(v => !v)} />
                                </>
                            )}
                            <button
                                onClick={() => setModalOpen(true)}
                                className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700/60 rounded-lg text-[11px] font-medium text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer transition-colors"
                            >
                                <RiHistoryLine className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Chart area */}
                <div className="relative pt-2">
                    {isLoading && <LoadingOverlay isDark={isDark} />}

                    {tooltip && (
                        <ChartTooltip
                            tooltip={tooltip}
                            cw={cw}
                            theme={theme}
                            showPE={showPE && isVN}
                            showPB={showPB && isVN}
                        />
                    )}

                    <div ref={wrapRef} className="w-full" style={{ height: ch }} />
                </div>

                {/* PE/PB legend strip */}
                {isVN && (showPE || showPB) && (
                    <div className="flex items-center gap-4 px-6 py-2.5 border-t border-gray-100 dark:border-gray-800 text-[11px] text-gray-500">
                        {showPE && <LegendItem color={PE_COLOR} label="P/E TTM" />}
                        {showPB && <LegendItem color={PB_COLOR} label="P/B TTM" />}
                        <span className="ml-auto text-gray-400 text-[10px]">← left axis</span>
                    </div>
                )}
            </div>

            {modalOpen && selected && (
                <IndexHistoryModal
                    isOpen={modalOpen}
                    onClose={() => setModalOpen(false)}
                    indexId={selected.id}
                    indexName={selected.name}
                />
            )}
        </>
    );
}

// ── Tiny helper components ────────────────────────────────────────────────────

function Stat({ label, value, color, labelColor, suffix, suffixColor }: {
    label: string; value: string;
    color?: string; labelColor?: string;
    suffix?: string; suffixColor?: string;
}) {
    return (
        <div>
            <div className={cx('text-[9.5px] font-semibold uppercase tracking-[0.06em]', labelColor ?? 'text-gray-400')}>{label}</div>
            <div className={cx('text-xs font-medium tabular-nums mt-0.5', color ?? 'text-gray-700 dark:text-gray-300')}>
                {value}
                {suffix && <span className={cx('ml-0.5', suffixColor)}>{suffix}</span>}
            </div>
        </div>
    );
}

function ToggleBtn({ active, color, label, onClick }: {
    active: boolean; color: 'indigo' | 'emerald'; label: string; onClick: () => void;
}) {
    return (
        <button onClick={onClick} className={cx(
            'px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer',
            active && color === 'indigo'
                ? 'bg-indigo-50 border-indigo-200 text-indigo-600 dark:bg-indigo-500/10 dark:border-indigo-500/30 dark:text-indigo-400'
                : active && color === 'emerald'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-600 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400'
                : 'bg-gray-50 border-gray-100 text-gray-400 dark:bg-gray-800 dark:border-gray-700/60 hover:text-gray-600',
        )}>
            {label}
        </button>
    );
}

function LegendItem({ color, label }: { color: string; label: string }) {
    return (
        <span className="flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-5 rounded" style={{ backgroundColor: color }} />
            {label}
        </span>
    );
}

function LoadingOverlay({ isDark }: { isDark: boolean }) {
    return (
        <div className="absolute inset-0 z-20 flex items-center justify-center"
            style={{ backgroundColor: isDark ? 'rgba(17,24,39,0.55)' : 'rgba(255,255,255,0.55)' }}>
            <div className="flex items-center gap-2 text-xs text-gray-400">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Loading…
            </div>
        </div>
    );
}

function ChartTooltip({ tooltip, cw, theme, showPE, showPB }: {
    tooltip: any; cw: number;
    theme: ReturnType<typeof buildTheme>;
    showPE: boolean; showPB: boolean;
}) {
    return (
        <div
            className="pointer-events-none absolute z-30 rounded-lg px-3 py-2 text-xs shadow-xl"
            style={{
                left:  Math.min(tooltip.x + 14, cw - 200),
                top:   Math.max(tooltip.y - 10, 36),
                backgroundColor: theme.tooltipBg,
                border: `1px solid ${theme.tooltipBorder}`,
                color:  theme.tooltipText,
            }}
        >
            <div className="font-semibold mb-1" style={{ color: theme.tooltipMuted }}>{tooltip.time}</div>
            <div className="grid gap-y-0.5" style={{ gridTemplateColumns: 'auto auto', columnGap: 14 }}>
                <span style={{ color: theme.tooltipMuted }}>Close</span>
                <span className="font-bold text-right text-blue-500">{tooltip.close}</span>
                {tooltip.change && (
                    <>
                        <span style={{ color: theme.tooltipMuted }}>Chg</span>
                        <span className={cx('text-right font-semibold', tooltip.change.startsWith('+') ? 'text-emerald-500' : 'text-red-500')}>
                            {tooltip.change}
                        </span>
                    </>
                )}
                {tooltip.volume && tooltip.volume !== '0' && (
                    <>
                        <span style={{ color: theme.tooltipMuted }}>Vol</span>
                        <span className="text-right">{tooltip.volume}</span>
                    </>
                )}
                {showPE && tooltip.pe && (
                    <>
                        <span style={{ color: theme.tooltipMuted }}>P/E</span>
                        <span className="text-right font-semibold" style={{ color: PE_COLOR }}>{tooltip.pe}</span>
                    </>
                )}
                {showPB && tooltip.pb && (
                    <>
                        <span style={{ color: theme.tooltipMuted }}>P/B</span>
                        <span className="text-right font-semibold" style={{ color: PB_COLOR }}>{tooltip.pb}</span>
                    </>
                )}
            </div>
        </div>
    );
}

function SkeletonStats() {
    return (
        <div className="animate-pulse mt-2">
            <div className="h-11 w-48 rounded-md bg-gray-100 dark:bg-gray-800" />
            <div className="flex gap-4 mt-3">
                {[1,2,3,4,5].map(i => (
                    <div key={i}>
                        <div className="h-2 w-8 rounded bg-gray-100 dark:bg-gray-800 mb-1" />
                        <div className="h-3 w-12 rounded bg-gray-100 dark:bg-gray-800" />
                    </div>
                ))}
            </div>
        </div>
    );
}
