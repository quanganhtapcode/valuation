'use client';

import { useState, useEffect, useCallback } from 'react';

type FeedTab = 'news' | 'dividend' | 'insider' | 'agm' | 'other';

const TABS: { id: FeedTab; label: string; icon: string; shortLabel: string }[] = [
  { id: 'news', label: 'News', icon: '📰', shortLabel: 'News' },
  { id: 'dividend', label: 'Dividends', icon: '💰', shortLabel: 'Div' },
  { id: 'insider', label: 'Insider', icon: '👤', shortLabel: 'Insider' },
  { id: 'agm', label: 'AGM', icon: '🏛', shortLabel: 'AGM' },
  { id: 'other', label: 'Corp. Actions', icon: '📋', shortLabel: 'Actions' },
];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: diff > 365 ? 'numeric' : undefined,
  });
}

function fmtFullDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function countLabel(label: string, count?: number): string {
  if (count === undefined) return label;
  return `${label} (${count})`;
}

function NewsCard({ item }: { item: any }) {
  const title = item.newsTitle || '';
  const date = item.publicDate;
  const img = item.newsImageUrl || item.newsSmallImageUrl;
  const source = item.newsSource || item.source || 'VCI Feed';

  return (
    <article className="group rounded-xl border border-slate-200 bg-white p-3 transition-all hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700">
      <div className="flex gap-3">
        {img ? (
          <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
            <img
              src={img}
              alt=""
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        ) : (
          <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg dark:bg-slate-800">
            📰
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-snug text-slate-800 transition-colors group-hover:text-blue-600 dark:text-slate-100 dark:group-hover:text-blue-400">
            {title}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              {source}
            </span>
            <span className="text-slate-400 dark:text-slate-500">{fmtDate(date)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

const EVENT_META: Record<string, { label: string; color: string; dot: string }> = {
  DIV: { label: 'Cash Dividend', color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', dot: 'bg-emerald-500' },
  ISS: { label: 'Share Issue', color: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', dot: 'bg-blue-500' },
  DDIND: { label: 'Director Deal', color: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', dot: 'bg-purple-500' },
  DDINS: { label: 'Institutional', color: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', dot: 'bg-purple-500' },
  DDRP: { label: 'Report', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400', dot: 'bg-slate-400' },
  AGME: { label: 'AGM', color: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', dot: 'bg-amber-500' },
  AGMR: { label: 'AGM Result', color: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', dot: 'bg-amber-500' },
  EGME: { label: 'EGM', color: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', dot: 'bg-amber-500' },
  AIS: { label: 'Add. Listing', color: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400', dot: 'bg-sky-500' },
  MA: { label: 'M&A', color: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400', dot: 'bg-rose-500' },
  MOVE: { label: 'Transfer', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400', dot: 'bg-slate-400' },
  NLIS: { label: 'New Listing', color: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400', dot: 'bg-sky-500' },
  OTHE: { label: 'Other', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400', dot: 'bg-slate-400' },
  RETU: { label: 'Return', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400', dot: 'bg-slate-400' },
  SUSP: { label: 'Suspended', color: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400', dot: 'bg-red-500' },
};

function EventCard({ item, isLast }: { item: any; isLast: boolean }) {
  const code = item.eventCode || '';
  const meta = EVENT_META[code] ?? {
    label: code || 'Event',
    color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    dot: 'bg-slate-400',
  };
  const title = item.eventTitleEn || item.eventTitleVi || item.eventNameEn || '';
  const date1 = fmtFullDate(item.displayDate1 || item.publicDate);
  const action = item.actionTypeEn;
  const value = item.valuePerShare;
  const ratio = item.exerciseRatio;
  const isBuy = action === 'Buy';
  const isSell = action === 'Sell';

  return (
    <article className="relative rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex gap-3">
        <div className="flex shrink-0 flex-col items-center pt-1">
          <div className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
          {!isLast && <div className="mt-1 h-full w-px bg-slate-200 dark:bg-slate-700/70" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-2">
            <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-slate-800 dark:text-slate-100">
              {title}
            </p>
            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${meta.color}`}>
              {meta.label}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            {date1 && <span className="text-slate-400 dark:text-slate-500">{date1}</span>}
            {action && (
              <span
                className={`font-bold ${
                  isBuy ? 'text-emerald-600 dark:text-emerald-400' : isSell ? 'text-red-500 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {isBuy ? '▲' : isSell ? '▼' : ''} {action}
              </span>
            )}
            {value != null && (
              <span className="font-medium text-slate-600 dark:text-slate-300">
                {Number(value).toLocaleString('en-US')} VND/share
              </span>
            )}
            {ratio != null && value == null && (
              <span className="font-medium text-slate-600 dark:text-slate-300">
                {(Number(ratio) * 100).toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3 py-1">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex gap-3">
            <div className="h-14 w-20 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" />
            <div className="flex-1 space-y-2 pt-0.5">
              <div className="h-3.5 w-full rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-3.5 w-4/5 rounded bg-slate-100 dark:bg-slate-800" />
              <div className="h-2.5 w-20 rounded bg-slate-100 dark:bg-slate-800" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ tabLabel }: { tabLabel: string }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-6 text-center dark:border-slate-700 dark:bg-slate-900/40">
      <span className="text-2xl">🗂️</span>
      <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">No {tabLabel.toLowerCase()} available</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Try another tab for more updates and corporate actions.</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50/50 px-6 text-center dark:border-red-800/60 dark:bg-red-950/20">
      <span className="text-2xl">⚠️</span>
      <p className="mt-2 text-sm font-medium text-red-700 dark:text-red-300">Could not load feed</p>
      <p className="mt-1 text-xs text-red-600/90 dark:text-red-400">{message}</p>
    </div>
  );
}

export default function VciNewsFeed({ symbol }: { symbol: string }) {
  const [activeTab, setActiveTab] = useState<FeedTab>('news');
  const [data, setData] = useState<Partial<Record<FeedTab, any[]>>>({});
  const [loading, setLoading] = useState<Partial<Record<FeedTab, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<FeedTab, string>>>({});

  const load = useCallback(
    async (tab: FeedTab) => {
      if (data[tab] !== undefined || loading[tab]) return;
      setLoading((prev) => ({ ...prev, [tab]: true }));
      try {
        const res = await fetch(`/api/stock/vci-feed/${symbol}?tab=${tab}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Failed');
        setData((prev) => ({ ...prev, [tab]: json.data || [] }));
      } catch (e: any) {
        setErrors((prev) => ({ ...prev, [tab]: e.message }));
      } finally {
        setLoading((prev) => ({ ...prev, [tab]: false }));
      }
    },
    [symbol, data, loading],
  );

  useEffect(() => {
    load('news');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTab = (tab: FeedTab) => {
    setActiveTab(tab);
    load(tab);
  };

  const items = data[activeTab];
  const isLoad = loading[activeTab];
  const err = errors[activeTab];
  const activeTabMeta = TABS.find((t) => t.id === activeTab);
  const count = items?.length;

  return (
    <div className="overflow-hidden rounded-tremor-default border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
              Market Feed
            </p>
            <p className="text-xs text-tremor-content dark:text-dark-tremor-content">
              {countLabel(activeTabMeta?.label || 'Updates', count)}
            </p>
          </div>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {symbol.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-gray-100 bg-gray-50/70 px-2 py-2 dark:border-gray-800 dark:bg-gray-900/60">
        {TABS.map(({ id, label, icon, shortLabel }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => handleTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-all ${
                active
                  ? 'bg-white text-blue-600 shadow-sm ring-1 ring-blue-100 dark:bg-gray-800 dark:text-blue-400 dark:ring-blue-900/40'
                  : 'text-gray-600 hover:bg-white hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
              }`}
              title={label}
            >
              <span className="text-sm leading-none">{icon}</span>
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{shortLabel}</span>
            </button>
          );
        })}
      </div>

      <div className="px-4 py-3">
        <div className="max-h-[420px] overflow-y-auto pr-1">
          {isLoad && <Skeleton />}

          {!isLoad && err && <ErrorState message={err} />}

          {!isLoad && !err && items !== undefined && items.length === 0 && (
            <EmptyState tabLabel={activeTabMeta?.label || 'updates'} />
          )}

          {!isLoad && !err && items !== undefined && items.length > 0 && (
            <div className="space-y-3 pb-1">
              {activeTab === 'news'
                ? items.map((item, i) => <NewsCard key={item.id ?? i} item={item} />)
                : items.map((item, i) => <EventCard key={item.id ?? i} item={item} isLast={i === items.length - 1} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
