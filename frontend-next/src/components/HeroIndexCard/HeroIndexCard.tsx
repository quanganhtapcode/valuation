'use client';


import { localizedCopy } from '@/lib/localizedCopy';
import { apiFetch } from '@/lib/apiFetch';

import { chartColors, getChartTheme } from '@/lib/chartTheme';

import { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
    createChart,
    IChartApi,
    ISeriesApi,
    AreaSeries,
    LineSeries,
    HistogramSeries,
    BusinessDay,
    ColorType,
    CrosshairMode,
    MouseEventParams,
} from 'lightweight-charts';
import { API_BASE, INDEX_MAP, PEChartData, isTradingHours } from '@/lib/api';
import { fetchPEChartPage, mergeValuationHistory, parseValuationPagination, parsePEChartPayload } from '@/lib/valuationChartApi';
import { createFrameStore } from '@/lib/frameStore';
import { cx } from '@/lib/utils';
import { RiHistoryLine } from '@remixicon/react';
import dynamic from 'next/dynamic';
import { useLanguage } from '@/contexts/LanguageContext';

const IndexHistoryModal = dynamic(() => import('@/components/HeroIndexCard/IndexHistoryModal'), {
    ssr: false,
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface IndexData {
    id: string;
    name: string;
    value: number;
    change: number;
    percentChange: number;
    isReference?: boolean;
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
    initialChart?: unknown;
}

interface SimpleBar { date: string; close: number; volume: number }

// ── Constants ─────────────────────────────────────────────────────────────────

const INDEX_TABS = [
    { id: 'vnindex', label: 'VN-Index' },
    { id: 'vn30',    label: 'VN30'     },
    { id: 'hnx',     label: 'HNX'      },
    { id: 'upcom',   label: 'UPCOM'    },
];

const PE_COLOR  = chartColors.secondary;
const PB_COLOR  = chartColors.tertiary;
const AREA_COLOR = '#0E6BFF';
const INDEX_HISTORY_PAGE_SIZE = 260;

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateToISO(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function toBusinessDay(iso: string): BusinessDay {
    const [y, m, day] = iso.split('-').map(Number);
    return { year: y, month: m, day };
}

function fmtDate(t: BusinessDay): string {
    return `${String(t.day).padStart(2, '0')}/${String(t.month).padStart(2, '0')}/${t.year}`;
}

function dayKey(t: BusinessDay): string {
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

const buildTheme = getChartTheme;

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
            'inline-flex items-center gap-1 rounded-full font-semibold tabular-nums whitespace-nowrap',
            large ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]',
            up  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
        )}>
            <svg width={large ? 9 : 7} height={large ? 9 : 7} viewBox="0 0 10 10">
                <path d={up ? 'M5 1 L9 8 L1 8 Z' : 'M5 9 L1 2 L9 2 Z'} fill="currentColor" />
            </svg>
            {up ? '+' : ''}{pct.toFixed(2)}%
        </span>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HeroIndexCard({ indices, initialChart }: HeroIndexCardProps) {
    const { lang } = useLanguage();
    const referenceLabel = localizedCopy[lang].components_HeroIndexCard_HeroIndexCard.referencePrice;
    const isDark = useDarkMode();
    const theme  = useMemo(() => buildTheme(isDark), [isDark]);

    // ── UI state ──────────────────────────────────────────────────────────────
    const [selectedId, setSelectedId] = useState('vnindex');
    const [showPE,     setShowPE]     = useState(false);
    const [showPB,     setShowPB]     = useState(false);
    const [modalOpen,  setModalOpen]  = useState(false);

    // ── Data state ────────────────────────────────────────────────────────────
    const initialRows = useMemo(() => parsePEChartPayload(initialChart), [initialChart]);
    const [vnRows,   setVnRows]   = useState<PEChartData[]>(initialRows);
    const [vnRequest, setVnRequest] = useState<{ before?: string; id: number }>({ id: 0 });
    const [vnLoad,   setVnLoad]   = useState(false);
    const [vnError, setVnError] = useState(false);
    const [vnRetry, setVnRetry] = useState(0);
    const [idxBars,  setIdxBars]  = useState<SimpleBar[]>([]);
    const [idxLoad,  setIdxLoad]  = useState(false);
    const idxCache  = useRef<Map<string, SimpleBar[]>>(new Map());
    const idxNextBefore = useRef<Map<string, string | null>>(new Map());
    const [idxRequest, setIdxRequest] = useState<{ index: string; before: string } | null>(null);
    const idxLoadingRef = useRef(false);
    const paginationRef = useRef(parseValuationPagination(initialChart) ?? {
        hasMore: initialRows.length > 0,
        nextBefore: initialRows.length ? dateToISO(initialRows[0].date) : null,
    });
    const vnErrorRef = useRef(false);
    const timelineRef = useRef<string[]>([]);
    const livePointsRef = useRef<Map<string, { time: BusinessDay; value: number }>>(new Map());
    const userChartInteractionRef = useRef(false);
    const fittedViewForRef = useRef<string | null>(null);
    const selectedIdRef = useRef(selectedId);
    const preserveVisibleRangeRef = useRef(false);
    const vnLoadingRef = useRef(vnLoad);


    // ── Chart refs ────────────────────────────────────────────────────────────
    const wrapRef   = useRef<HTMLDivElement>(null);
    const chartRef  = useRef<IChartApi | null>(null);
    const areaRef   = useRef<ISeriesApi<'Area'> | null>(null);
    const volRef    = useRef<ISeriesApi<'Histogram'> | null>(null);
    const peRef     = useRef<ISeriesApi<'Line'> | null>(null);
    const pbRef     = useRef<ISeriesApi<'Line'> | null>(null);
    const previousCloseMap = useRef<Map<string, number>>(new Map());
    const updatingSeriesRef = useRef(false);
    const [tooltipStore] = useState(() => createFrameStore<TooltipData | null>(null));
    const setTooltip = tooltipStore.publish;
    const [cw,      setContainerW]    = useState(800);
    const [ch,      setContainerH]    = useState(380);

    const isVN     = selectedId === 'vnindex';
    const selected = indices.find(i => i.id === selectedId) || indices[0];

    // Fetch a bounded page, then request only older dates as the user pans left.
    useEffect(() => {
        if (vnRequest.id === 0 && initialRows.length && vnRetry === 0) return;
        const controller = new AbortController();
        queueMicrotask(() => {
            if (!controller.signal.aborted) { setVnError(false); setVnLoad(true); }
        });
        vnErrorRef.current = false;
        vnLoadingRef.current = true;
        fetchPEChartPage(vnRequest.before, { signal: controller.signal })
            .then(({ series, pagination }) => {
                if (controller.signal.aborted) return;
                paginationRef.current = pagination;
                preserveVisibleRangeRef.current = Boolean(vnRequest.before) && selectedIdRef.current === 'vnindex';
                setVnRows(current => mergeValuationHistory(current, series));
            })
            .catch(error => {
                if (!controller.signal.aborted) {
                    vnErrorRef.current = true;
                    setVnError(true);
                    console.error(error);
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) { vnLoadingRef.current = false; setVnLoad(false); }
            });
        return () => controller.abort();
    }, [vnRequest, vnRetry, initialRows.length]);

    useEffect(() => {
        selectedIdRef.current = selectedId;
        preserveVisibleRangeRef.current = false;
        userChartInteractionRef.current = false;
        timelineRef.current = [];
        // Switching an index should fit that index once; extending its history
        // must preserve the user's current pan position.
        fittedViewForRef.current = null;
    }, [selectedId]);

    // ── Fetch other indices on demand ─────────────────────────────────────────
    useEffect(() => {
        if (isVN) return;
        const info = Object.values(INDEX_MAP).find(i => i.id === selectedId);
        if (!info) return;

        const cached = idxCache.current.get(selectedId);
        if (cached) { setIdxBars(cached); setIdxLoad(false); return; }

        const controller = new AbortController();
        idxLoadingRef.current = true;
        setIdxLoad(true);
        setIdxBars([]);
        apiFetch(`${API_BASE}/market/indices/history?index=${info.vciSymbol}&days=${INDEX_HISTORY_PAGE_SIZE}&compact=1`, { signal: controller.signal })
            .then(r => r.json())
            .then((rows: any[]) => {
                if (controller.signal.aborted || !Array.isArray(rows)) return;
                const bars = rows
                    .filter(r => r.tradingDate && r.closeIndex)
                    .map(r => ({
                        date:   String(r.tradingDate).slice(0, 10),
                        close:  Number(r.closeIndex),
                        volume: Number(r.totalVolume || r.totalMatchVolume || 0),
                    }))
                    .sort((a, b) => a.date.localeCompare(b.date));
                idxNextBefore.current.set(selectedId, bars.length >= INDEX_HISTORY_PAGE_SIZE ? bars[0].date : null);
                idxCache.current.set(selectedId, bars);
                setIdxBars(bars);
            })
            .catch(error => {
                if (error.name !== 'AbortError') console.error(error);
            })
            .finally(() => {
                if (!controller.signal.aborted) { idxLoadingRef.current = false; setIdxLoad(false); }
            });
        return () => controller.abort();
    }, [selectedId, isVN]);

    useEffect(() => {
        if (!idxRequest || idxRequest.index !== selectedId) return;
        const info = Object.values(INDEX_MAP).find(i => i.id === idxRequest.index);
        if (!info) return;
        const controller = new AbortController();
        idxLoadingRef.current = true;
        const query = new URLSearchParams({ index: info.vciSymbol, days: String(INDEX_HISTORY_PAGE_SIZE), compact: '1', before: idxRequest.before });
        apiFetch(`${API_BASE}/market/indices/history?${query}`, { signal: controller.signal })
            .then(r => r.json())
            .then((rows: any[]) => {
                if (controller.signal.aborted || !Array.isArray(rows)) return;
                const older = rows.filter(r => r.tradingDate && r.closeIndex).map(r => ({
                    date: String(r.tradingDate).slice(0, 10),
                    close: Number(r.closeIndex),
                    volume: Number(r.totalVolume || r.totalMatchVolume || 0),
                }));
                idxNextBefore.current.set(idxRequest.index, older.length >= INDEX_HISTORY_PAGE_SIZE ? older[older.length - 1].date : null);
                const current = idxCache.current.get(idxRequest.index) ?? [];
                const merged = [...new Map([...current, ...older].map(bar => [bar.date, bar])).values()]
                    .sort((a, b) => a.date.localeCompare(b.date));
                idxCache.current.set(idxRequest.index, merged);
                if (selectedIdRef.current === idxRequest.index) {
                    preserveVisibleRangeRef.current = true;
                    setIdxBars(merged);
                }
            })
            .catch(error => {
                if (error.name !== 'AbortError') console.error(error);
            })
            .finally(() => {
                if (!controller.signal.aborted) { idxLoadingRef.current = false; setIdxLoad(false); }
            });
        return () => controller.abort();
    }, [idxRequest, selectedId]);

    // ── Derive full-history chart series ─────────────────────────────────────

    const priceTV = useMemo(() => {
        if (isVN) {
            return vnRows
                .filter(d => d.vnindex !== null)
                .map(d => ({ time: toBusinessDay(dateToISO(d.date)), value: d.vnindex!, volume: d.volume ?? 0 }));
        }
        return idxBars
            .map(d => ({ time: toBusinessDay(d.date), value: d.close, volume: d.volume }));
    }, [isVN, vnRows, idxBars]);

    const peTV = useMemo(() =>
        vnRows
            .filter(d => d.pe !== null)
            .map(d => ({ time: toBusinessDay(dateToISO(d.date)), value: d.pe! })),
        [vnRows],
    );

    const pbTV = useMemo(() =>
        vnRows
            .filter(d => d.pb !== null)
            .map(d => ({ time: toBusinessDay(dateToISO(d.date)), value: d.pb! })),
        [vnRows],
    );

    // Latest stats for header display
    const latestVN = useMemo(() => {
        for (let i = vnRows.length - 1; i >= 0; i--) {
            if (vnRows[i].vnindex !== null) return vnRows[i];
        }
        return null;
    }, [vnRows]);

    // ── Chart initialisation (once) ───────────────────────────────────────────
    useEffect(() => {
        if (!wrapRef.current || chartRef.current) return;

        const t0 = buildTheme(document.documentElement.classList.contains('dark'));
        const chart = createChart(wrapRef.current, {
            width:  wrapRef.current.clientWidth,
            height: ch,
            layout: {
                background:  { type: ColorType.Solid, color: 'transparent' },
                textColor:   t0.text,
                fontSize:    11,
                fontFamily:  getComputedStyle(document.body).fontFamily,
            },
            grid: {
                vertLines: { visible: false },
                horzLines: { visible: true, color: t0.gridLine },
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
                minBarSpacing:         0.01,
                rightBarStaysOnScroll: true,
            },
            handleScroll: { vertTouchDrag: false },
            handleScale:  { axisPressedMouseMove: { time: true, price: true } },
        });

        const area = chart.addSeries(AreaSeries, {
            topColor:                       `${AREA_COLOR}20`,
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
            priceLineVisible: false,
            lastValueVisible: false,
        });
        vol.priceScale().applyOptions({
            scaleMargins: { top: 0.90, bottom: 0 },
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

            const close  = (areaVal as { value: number }).value;
            const volVal = param.seriesData.get(vol);
            const peVal  = param.seriesData.get(pe);
            const pbVal  = param.seriesData.get(pb);
            const t      = param.time as BusinessDay;
            const k      = dayKey(t);
            const prev = previousCloseMap.current.get(k);
            let change = '';
            if (prev !== undefined) {
                const ch   = close - prev;
                const pct  = prev > 0 ? (ch / prev) * 100 : 0;
                change = `${ch >= 0 ? '+' : ''}${ch.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
            }

            setTooltip({
                time:   fmtDate(t),
                close:  close.toLocaleString('en-US', { maximumFractionDigits: 2 }),
                change,
                volume: fmtVol((volVal as { value?: number } | undefined)?.value ?? 0),
                pe:     peVal ? (((peVal as { value: number }).value).toFixed(2) + 'x') : null,
                pb:     pbVal ? (((pbVal as { value: number }).value).toFixed(2) + 'x') : null,
                x: param.point?.x ?? 0,
                y: param.point?.y ?? 0,
            });
        });

        chartRef.current = chart;
        areaRef.current  = area;
        volRef.current   = vol;
        peRef.current    = pe;
        pbRef.current    = pb;

        let resizeFrame = 0;
        const ro = new ResizeObserver(([e]) => {
            const w = e.contentRect.width;
            const h = w < 640 ? 300 : 380;
            cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(() => {
                setContainerW(w || 800);
                setContainerH(h);
                chart.applyOptions({ width: w, height: h });
            });
        });
        ro.observe(wrapRef.current);

        const onVisibleRangeChange = (range: { from: number; to: number } | null) => {
            if (!range || updatingSeriesRef.current || !userChartInteractionRef.current) return;
            // Load with half a screen of history still available.
            if (range.from > Math.max(60, (range.to - range.from) * 0.5)) return;
            if (selectedIdRef.current !== 'vnindex') {
                const id = selectedIdRef.current;
                const before = idxNextBefore.current.get(id);
                if (!idxLoadingRef.current && before) {
                    idxLoadingRef.current = true;
                    userChartInteractionRef.current = false;
                    setIdxLoad(true);
                    setIdxRequest({ index: id, before });
                }
                return;
            }
            if (vnLoadingRef.current) return;
            const page = paginationRef.current;
            if (!page.hasMore || !page.nextBefore || vnErrorRef.current) return;
            // Lock before React processes another pan event.
            vnLoadingRef.current = true;
            userChartInteractionRef.current = false;
            setVnRequest(current => ({ before: page.nextBefore!, id: current.id + 1 }));
        };
        chart.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChange);

        return () => {
            ro.disconnect();
            cancelAnimationFrame(resizeFrame);
            tooltipStore.dispose();
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange);
            chart.remove();
            chartRef.current = areaRef.current = volRef.current = peRef.current = pbRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Sync theme ────────────────────────────────────────────────────────────
    useEffect(() => {
        chartRef.current?.applyOptions({
            layout:          { textColor: theme.text },
            grid:            { vertLines: { visible: false }, horzLines: { visible: true, color: theme.gridLine } },
            rightPriceScale: { borderColor: theme.border },
            leftPriceScale:  { borderColor: theme.border },
            timeScale:       { borderColor: theme.border },
            crosshair:       { vertLine: { color: theme.crosshair }, horzLine: { color: theme.crosshair } },
        });
    }, [theme]);

    // ── Push price data ───────────────────────────────────────────────────────
    useEffect(() => {
        if (!areaRef.current || !volRef.current || !priceTV.length) return;
        // Preserve the latest view, including pans made while loading.
        const visibleRange = preserveVisibleRangeRef.current
            ? chartRef.current?.timeScale().getVisibleLogicalRange()
            : null;
        const timeline = [...new Set([
            ...priceTV.map(row => dayKey(row.time)),
            ...(isVN ? [...peTV, ...pbTV].map(row => dayKey(row.time)) : []),
        ])].sort();
        const oldFirst = timelineRef.current[0];
        const added = oldFirst ? timeline.filter(date => date < oldFirst).length : 0;
        timelineRef.current = timeline;
        updatingSeriesRef.current = true;
        try {
            areaRef.current.setData(priceTV.map(d => ({ time: d.time, value: d.value })));
            previousCloseMap.current = new Map(priceTV.slice(1).map((d, i) => [dayKey(d.time), priceTV[i].value]));
            volRef.current.setData(priceTV.map((d, i) => ({
                time:  d.time,
                value: d.volume,
                color: i === 0 || d.value >= priceTV[i - 1].value
                    ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
            })));
            peRef.current?.setData(isVN ? peTV : []);
            pbRef.current?.setData(isVN ? pbTV : []);
            // Re-apply live today-point if already received
            const livePoint = livePointsRef.current.get(selectedId);
            if (livePoint) {
                try { areaRef.current.update(livePoint); } catch {}
            }
            // Fit only a newly selected index. Do not snap the chart back to the
            // latest year when older history arrives during a user pan.
            if (visibleRange) {
                chartRef.current?.timeScale().setVisibleLogicalRange({ from: visibleRange.from + added, to: visibleRange.to + added });
                preserveVisibleRangeRef.current = false;
                fittedViewForRef.current = selectedId;
                return;
            }
            if (fittedViewForRef.current === selectedId) return;
            const latest = livePoint
                ? livePoint.time
                : priceTV[priceTV.length - 1].time;
            const from = new Date(Date.UTC(latest.year - 1, latest.month - 1, latest.day));
            const firstDate = dayKey(priceTV[0].time);
            const startDate = dateToISO(from);
            chartRef.current?.timeScale().setVisibleRange({
                from: toBusinessDay(startDate < firstDate ? firstDate : startDate),
                to: latest,
            });
            fittedViewForRef.current = selectedId;
        } finally {
            updatingSeriesRef.current = false;
        }
    }, [priceTV, selectedId, isVN, peTV, pbTV]);

    // ── PE/PB overlay visibility ──────────────────────────────────────────────
    useEffect(() => {
        if (!peRef.current || !pbRef.current || !chartRef.current) return;
        const hasOverlay = (showPE || showPB) && isVN;
        peRef.current.applyOptions({ visible: showPE && isVN });
        pbRef.current.applyOptions({ visible: showPB && isVN });
        chartRef.current.applyOptions({ leftPriceScale: { visible: hasOverlay } });
        queueMicrotask(() => setTooltip(null));
    }, [showPE, showPB, isVN, setTooltip]);

    // ── On index switch: hide overlays if leaving VN-Index ────────────────────
    useEffect(() => {
        if (!chartRef.current) return;
        if (!isVN) {
            peRef.current?.applyOptions({ visible: false });
            pbRef.current?.applyOptions({ visible: false });
            chartRef.current.applyOptions({ leftPriceScale: { visible: false } });
        }
        queueMicrotask(() => setTooltip(null));
    }, [isVN, selectedId, setTooltip]);

    // ── Live selected-index point via the shared quote stream ──
    useEffect(() => {
        if (!isTradingHours()) return;
        const vnidx = indices.find(i => i.id === selectedId);
        if (!vnidx?.value || vnidx.isReference || !areaRef.current) return;
        const now = new Date();
        const vnMs = now.getTime() + now.getTimezoneOffset() * 60_000 + 7 * 3_600_000;
        const vn = new Date(vnMs);
        const point = {
            time:  { year: vn.getFullYear(), month: vn.getMonth() + 1, day: vn.getDate() } as BusinessDay,
            value: vnidx.value,
        };
        livePointsRef.current.set(selectedId, point);
        if (priceTV.length) {
            try { areaRef.current.update(point); } catch {}
        }
    }, [indices, selectedId, priceTV]);

    // ── Render ────────────────────────────────────────────────────────────────
    const isUp      = (selected?.change ?? 0) >= 0;
    // Retain the existing chart during background history expansion; an overlay
    // on every pan makes the interaction feel broken even though data is loading.
    const isLoading = (isVN ? vnLoad : idxLoad) && priceTV.length === 0;

    return (
        <>
            {/* ── Index sub-bar ── */}
            <div role="tablist" aria-label={lang === 'vi' ? 'Chọn chỉ số thị trường' : 'Select market index'} className="flex items-stretch overflow-x-auto rounded-t-2xl border border-b-0 border-slate-200/80 bg-white px-2 pt-2 dark:border-slate-800 dark:bg-slate-900 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {INDEX_TABS.map(tab => {
                    const idx    = indices.find(i => i.id === tab.id);
                    const active = tab.id === selectedId;
                    const up     = (idx?.change ?? 0) >= 0;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            id={`index-tab-${tab.id}`}
                            aria-controls="index-market-panel"
                            aria-selected={active}
                            onClick={() => setSelectedId(tab.id)}
                            className={cx(
                                'relative flex min-w-[136px] flex-shrink-0 cursor-pointer flex-col items-start gap-1 rounded-t-lg border-b-2 px-4 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-500 sm:min-w-[160px]',
                                active
                                    ? 'border-b-blue-600 bg-blue-50/60 dark:bg-blue-500/10'
                                    : 'border-b-transparent hover:bg-slate-50 dark:hover:bg-slate-800/40',
                            )}
                        >
                            <span className={cx('text-[11px] font-semibold whitespace-nowrap', active ? 'text-blue-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400')}>
                                {tab.label}
                            </span>
                            {idx && idx.value > 0 && (
                                <span className="flex items-baseline gap-2 whitespace-nowrap">
                                    <span className={cx('text-sm font-bold tracking-tight tabular-nums', active ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300')}>
                                        {idx.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                                    </span>
                                    <span className={cx('text-[10px] font-semibold tabular-nums', idx.isReference
                                        ? 'text-slate-400 dark:text-slate-500'
                                        : up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>
                                        {idx.isReference ? referenceLabel : `${up ? '+' : ''}${idx.percentChange.toFixed(2)}%`}
                                    </span>
                                </span>
                            )}
                        </button>
                    );
                })}
                <div className="flex-1" />
            </div>

            {/* ── Hero card ── */}
            <div id="index-market-panel" role="tabpanel" aria-labelledby={`index-tab-${selectedId}`} className="overflow-hidden rounded-b-2xl border border-slate-200/80 bg-white shadow-[0_10px_32px_rgba(15,23,42,0.045)] dark:border-slate-800 dark:bg-slate-900">

                {/* Stats header */}
                <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-6 pb-0 md:px-7 md:pt-7">

                    {/* Left: price + KPIs */}
                    <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {selected?.name || '—'}
                        </div>

                        {selected && selected.value > 0 ? (
                            <>
                                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-2">
                                    <span className={cx(
                                        'text-[40px] font-bold tabular-nums leading-none tracking-[-0.045em] text-slate-950 dark:text-white sm:text-[48px]',
                                    )}>
                                        {selected.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                                    </span>
                                    {selected.isReference ? <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{referenceLabel}</span> : <div className="flex items-center gap-2">
                                        <span className={cx('font-semibold tabular-nums text-sm', isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                                            {isUp ? '+' : ''}{selected.change.toFixed(2)}
                                        </span>
                                        <PctChip pct={selected.percentChange} large />
                                    </div>}
                                </div>

                                <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 border-t border-slate-100 pt-4 dark:border-slate-800/80">
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
                                        <Stat label="P/E" value={`${latestVN.pe.toFixed(2)}x`} color="text-blue-600 dark:text-blue-400" />
                                    )}
                                    {isVN && latestVN?.pb !== null && latestVN?.pb !== undefined && (
                                        <Stat label="P/B" value={`${latestVN.pb.toFixed(2)}x`} color="text-violet-600 dark:text-violet-400" />
                                    )}
                                </div>
                            </>
                        ) : (
                            <SkeletonStats />
                        )}
                    </div>

                    {/* Right: controls */}
                    <div className="flex flex-col gap-2 items-end flex-shrink-0 pt-0.5">
                        {/* PE / PB toggles (VN-Index only) + History */}
                        <div className="flex gap-1.5">
                            {isVN && (
                                <>
                                    <ToggleBtn active={showPE} color="blue" label="P/E" onClick={() => setShowPE(v => !v)} />
                                    <ToggleBtn active={showPB} color="violet" label="P/B" onClick={() => setShowPB(v => !v)} />
                                </>
                            )}
                            <button
                                type="button"
                                aria-label={localizedCopy[lang].components_HeroIndexCard_HeroIndexCard.indexHistory}
                                onClick={() => setModalOpen(true)}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                            >
                                <RiHistoryLine className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Chart area */}
                <div className="relative pt-5">
                    {isLoading && <LoadingOverlay isDark={isDark} />}
                    {((isVN && vnLoad && vnRows.length > 0) || (!isVN && idxLoad && idxBars.length > 0)) && <div role="status" className="pointer-events-none absolute left-3 top-5 z-20 rounded-md bg-white/90 px-2 py-1 text-xs text-gray-500 dark:bg-gray-900/90">
                        {localizedCopy[lang].components_HeroIndexCard_HeroIndexCard.loadingHistory}
                    </div>}
                    {isVN && vnError && !vnLoad && <div role="alert" className="absolute inset-x-0 top-8 z-20 flex justify-center gap-2 text-xs text-gray-500">
                        <span>{vnRows.length ? (localizedCopy[lang].components_HeroIndexCard_HeroIndexCard.earlierHistoryIsUnavailable) : (localizedCopy[lang].components_HeroIndexCard_HeroIndexCard.chartDataIsUnavailable)}</span>
                        <button type="button" className="underline" onClick={() => setVnRetry(value => value + 1)}>{localizedCopy[lang].components_HeroIndexCard_HeroIndexCard.retry}</button>
                    </div>}

                    <ChartTooltip
                        store={tooltipStore}
                        cw={cw}
                        theme={theme}
                        showPE={showPE && isVN}
                        showPB={showPB && isVN}
                    />

                    <div
                        ref={wrapRef}
                        className="w-full"
                        style={{ height: ch }}
                        onPointerDown={() => { userChartInteractionRef.current = true; }}
                        onWheel={() => { userChartInteractionRef.current = true; }}
                    />
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
        <div className="min-w-[54px]">
            <div className={cx('text-[10px] font-semibold uppercase tracking-[0.08em]', labelColor ?? 'text-slate-400 dark:text-slate-500')}>{label}</div>
            <div className={cx('mt-1 text-[13px] font-semibold tabular-nums', color ?? 'text-slate-800 dark:text-slate-200')}>
                {value}
                {suffix && <span className={cx('ml-0.5', suffixColor)}>{suffix}</span>}
            </div>
        </div>
    );
}

function ToggleBtn({ active, color, label, onClick }: {
    active: boolean; color: 'blue' | 'violet'; label: string; onClick: () => void;
}) {
    return (
        <button type="button" aria-pressed={active} onClick={onClick} className={cx(
            'rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-500',
            active && color === 'blue'
                ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-500/10 dark:border-blue-500/30 dark:text-blue-400'
                : active && color === 'violet'
                ? 'bg-violet-50 border-violet-200 text-violet-700 dark:bg-violet-500/10 dark:border-violet-500/30 dark:text-violet-400'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800',
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

interface TooltipData {
    time: string; close: string; change: string; volume: string;
    pe: string | null; pb: string | null; x: number; y: number;
}

function ChartTooltip({ store, cw, theme, showPE, showPB }: {
    store: ReturnType<typeof createFrameStore<TooltipData | null>>; cw: number;
    theme: ReturnType<typeof buildTheme>;
    showPE: boolean; showPB: boolean;
}) {
    const tooltip = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    if (!tooltip) return null;
    return (
        <div
            className="pointer-events-none absolute z-30 min-w-[156px] rounded-xl px-3 py-2.5 text-xs shadow-[0_12px_30px_rgba(15,23,42,0.14)]"
            style={{
                left:  Math.max(0, Math.min(tooltip.x + 14, cw - 200)),
                top:   Math.max(tooltip.y - 10, 36),
                backgroundColor: theme.tooltipBg,
                border: `1px solid ${theme.tooltipBorder}`,
                color:  theme.tooltipText,
            }}
        >
            <div className="mb-2 border-b pb-1.5 font-semibold tabular-nums" style={{ color: theme.tooltipMuted, borderColor: theme.tooltipBorder }}>{tooltip.time}</div>
            <div className="grid gap-y-1" style={{ gridTemplateColumns: 'auto auto', columnGap: 18 }}>
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
