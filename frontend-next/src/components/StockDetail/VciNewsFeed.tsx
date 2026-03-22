'use client';

import { useState, useEffect, useCallback } from 'react';

type FeedTab = 'news' | 'dividend' | 'insider' | 'agm' | 'other';

const TABS: { id: FeedTab; label: string; icon: string }[] = [
  { id: 'news',     label: 'News',            icon: '📰' },
  { id: 'dividend', label: 'Dividends',        icon: '💰' },
  { id: 'insider',  label: 'Insider',          icon: '👤' },
  { id: 'agm',      label: 'AGM',              icon: '🏛' },
  { id: 'other',    label: 'Corp. Actions',    icon: '📋' },
];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return `${diff}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: diff > 365 ? 'numeric' : undefined });
}

function fmtFullDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── News card ─────────────────────────────────────────────
function NewsCard({ item, idx }: { item: any; idx: number }) {
  const title = item.newsTitle || '';
  const date  = item.publicDate;
  const img   = item.newsImageUrl || item.newsSmallImageUrl;

  return (
    <div className="flex gap-3 py-3 border-b border-slate-100 dark:border-slate-800/60 last:border-0 group">
      {/* Thumbnail */}
      {img ? (
        <div className="shrink-0 w-16 h-12 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800">
          <img
            src={img}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      ) : (
        <div className="shrink-0 w-16 h-12 rounded-lg bg-gradient-to-br from-blue-50 to-slate-100 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center text-xl">
          📰
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
          {title}
        </p>
        <span className="mt-1 block text-[11px] text-slate-400 dark:text-slate-500">
          {fmtDate(date)}
        </span>
      </div>
    </div>
  );
}

// ── Event card ────────────────────────────────────────────
const EVENT_META: Record<string, { label: string; color: string; dot: string }> = {
  DIV:   { label: 'Cash Dividend',   color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', dot: 'bg-emerald-500' },
  ISS:   { label: 'Share Issue',     color: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',             dot: 'bg-blue-500'   },
  DDIND: { label: 'Director Deal',   color: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',     dot: 'bg-purple-500' },
  DDINS: { label: 'Institutional',   color: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',     dot: 'bg-purple-500' },
  DDRP:  { label: 'Report',          color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',           dot: 'bg-slate-400'  },
  AGME:  { label: 'AGM',             color: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',         dot: 'bg-amber-500'  },
  AGMR:  { label: 'AGM Result',      color: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',         dot: 'bg-amber-500'  },
  EGME:  { label: 'EGM',             color: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',         dot: 'bg-amber-500'  },
  AIS:   { label: 'Add. Listing',    color: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',                 dot: 'bg-sky-500'    },
  MA:    { label: 'M&A',             color: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',             dot: 'bg-rose-500'   },
  MOVE:  { label: 'Transfer',        color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',           dot: 'bg-slate-400'  },
  NLIS:  { label: 'New Listing',     color: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',                 dot: 'bg-sky-500'    },
  OTHE:  { label: 'Other',           color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',           dot: 'bg-slate-400'  },
  RETU:  { label: 'Return',          color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',           dot: 'bg-slate-400'  },
  SUSP:  { label: 'Suspended',       color: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',                 dot: 'bg-red-500'    },
};

function EventCard({ item }: { item: any }) {
  const code    = item.eventCode || '';
  const meta    = EVENT_META[code] ?? { label: code, color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400', dot: 'bg-slate-400' };
  const title   = item.eventTitleEn || item.eventTitleVi || item.eventNameEn || '';
  const date1   = fmtFullDate(item.displayDate1 || item.publicDate);
  const action  = item.actionTypeEn;
  const value   = item.valuePerShare;
  const ratio   = item.exerciseRatio;
  const isBuy   = action === 'Buy';
  const isSell  = action === 'Sell';

  return (
    <div className="flex gap-3 py-3 border-b border-slate-100 dark:border-slate-800/60 last:border-0">
      {/* Timeline dot */}
      <div className="flex flex-col items-center pt-1 shrink-0">
        <div className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />
        <div className="w-px flex-1 bg-slate-200 dark:bg-slate-700/60 mt-1" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-start gap-2">
          <p className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug line-clamp-2">
            {title}
          </p>
          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${meta.color}`}>
            {meta.label}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {date1 && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">{date1}</span>
          )}
          {action && (
            <span className={`text-[11px] font-bold ${isBuy ? 'text-emerald-600 dark:text-emerald-400' : isSell ? 'text-red-500 dark:text-red-400' : 'text-slate-500'}`}>
              {isBuy ? '▲' : isSell ? '▼' : ''} {action}
            </span>
          )}
          {value != null && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              {value.toLocaleString('en-US')} VND/share
            </span>
          )}
          {ratio != null && !value && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              {(ratio * 100).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Skeleton loader ────────────────────────────────────────
function Skeleton() {
  return (
    <div className="space-y-0">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex gap-3 py-3 border-b border-slate-100 dark:border-slate-800/60 last:border-0 animate-pulse">
          <div className="shrink-0 w-16 h-12 rounded-lg bg-slate-100 dark:bg-slate-800" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-full" />
            <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-3/4" />
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────
export default function VciNewsFeed({ symbol }: { symbol: string }) {
  const [activeTab, setActiveTab] = useState<FeedTab>('news');
  const [data, setData] = useState<Partial<Record<FeedTab, any[]>>>({});
  const [loading, setLoading] = useState<Partial<Record<FeedTab, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<FeedTab, string>>>({});

  const load = useCallback(async (tab: FeedTab) => {
    if (data[tab] !== undefined || loading[tab]) return;
    setLoading(prev => ({ ...prev, [tab]: true }));
    try {
      const res  = await fetch(`/api/stock/vci-feed/${symbol}?tab=${tab}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      setData(prev => ({ ...prev, [tab]: json.data || [] }));
    } catch (e: any) {
      setErrors(prev => ({ ...prev, [tab]: e.message }));
    } finally {
      setLoading(prev => ({ ...prev, [tab]: false }));
    }
  }, [symbol, data, loading]);

  useEffect(() => { load('news'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTab = (tab: FeedTab) => {
    setActiveTab(tab);
    load(tab);
  };

  const items   = data[activeTab];
  const isLoad  = loading[activeTab];
  const err     = errors[activeTab];

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">

      {/* Tab bar */}
      <div className="flex overflow-x-auto scrollbar-none border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30">
        {TABS.map(({ id, label, icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => handleTab(id)}
              className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-all ${
                active
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 bg-white dark:bg-slate-900'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white/70 dark:hover:bg-slate-800/60'
              }`}
            >
              <span className="text-sm leading-none">{icon}</span>
              <span className="hidden sm:inline">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="px-4 overflow-y-auto" style={{ maxHeight: 420 }}>
        {isLoad && <Skeleton />}
        {err && !isLoad && (
          <p className="py-8 text-center text-xs text-red-500">{err}</p>
        )}
        {!isLoad && !err && items !== undefined && items.length === 0 && (
          <p className="py-8 text-center text-xs text-slate-400">No data available</p>
        )}
        {!isLoad && items !== undefined && items.length > 0 && (
          activeTab === 'news'
            ? items.map((item, i) => <NewsCard key={item.id ?? i} item={item} idx={i} />)
            : items.map((item, i) => <EventCard key={item.id ?? i} item={item} />)
        )}
      </div>
    </div>
  );
}
