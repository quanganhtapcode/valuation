'use client';

import { useState, useEffect, useCallback } from 'react';

type FeedTab = 'news' | 'dividend' | 'insider' | 'agm' | 'other';

const TABS: { id: FeedTab; label: string }[] = [
  { id: 'news',     label: 'News'          },
  { id: 'dividend', label: 'Dividend'      },
  { id: 'insider',  label: 'Insider'       },
  { id: 'agm',      label: 'AGM'           },
  { id: 'other',    label: 'Corp. Actions' },
];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── News item ──────────────────────────────────────────────
function NewsRow({ item }: { item: any }) {
  return (
    <div className="py-2.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug">
        {item.newsTitle || item.newsId}
      </p>
      <span className="text-xs text-slate-400 mt-0.5 block">
        {fmtDate(item.publicDate)}
      </span>
    </div>
  );
}

// ── Event item ────────────────────────────────────────────
const EVENT_CODE_LABELS: Record<string, string> = {
  DIV: 'Dividend', ISS: 'Share Issue',
  DDIND: 'Director Deal', DDINS: 'Institutional Deal', DDRP: 'Report',
  AGME: 'AGM', AGMR: 'AGM Result', EGME: 'EGM',
  AIS: 'Add. Listing', MA: 'M&A', MOVE: 'Transfer', NLIS: 'New Listing',
  OTHE: 'Other', RETU: 'Return', SUSP: 'Suspended',
};

const ACTION_COLORS: Record<string, string> = {
  Buy:  'text-emerald-600 dark:text-emerald-400',
  Sell: 'text-red-500 dark:text-red-400',
};

function EventRow({ item }: { item: any }) {
  const title   = item.eventTitleEn || item.eventTitleVi || item.eventNameEn || '';
  const code    = item.eventCode || '';
  const label   = EVENT_CODE_LABELS[code] || code;
  const date1   = fmtDate(item.displayDate1 || item.publicDate);
  const action  = item.actionTypeEn;
  const value   = item.valuePerShare;
  const ratio   = item.exerciseRatio;

  return (
    <div className="py-2.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug flex-1">
          {title}
        </p>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
          {label}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
        {date1 && <span>{date1}</span>}
        {action && (
          <span className={`font-semibold ${ACTION_COLORS[action] ?? ''}`}>{action}</span>
        )}
        {value != null && <span>{value.toLocaleString('en-US')} VND/share</span>}
        {ratio != null && !value && <span>Ratio: {(ratio * 100).toFixed(1)}%</span>}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────
interface VciNewsFeedProps {
  symbol: string;
}

export default function VciNewsFeed({ symbol }: VciNewsFeedProps) {
  const [activeTab, setActiveTab] = useState<FeedTab>('news');
  const [data, setData] = useState<Record<FeedTab, any[] | null>>({
    news: null, dividend: null, insider: null, agm: null, other: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (tab: FeedTab) => {
    if (data[tab] !== null) return; // already loaded
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stock/vci-feed/${symbol}?tab=${tab}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      setData(prev => ({ ...prev, [tab]: json.data || [] }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [symbol, data]);

  useEffect(() => { load('news'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTab = (tab: FeedTab) => {
    setActiveTab(tab);
    load(tab);
  };

  const items = data[activeTab];

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      {/* Tab bar */}
      <div className="flex overflow-x-auto border-b border-slate-200 dark:border-slate-800 scrollbar-none">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => handleTab(id)}
            className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
              activeTab === id
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="px-3 py-1 max-h-80 overflow-y-auto">
        {loading && (
          <div className="flex justify-center py-6">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {error && !loading && (
          <p className="py-4 text-center text-xs text-red-500">{error}</p>
        )}
        {!loading && !error && items !== null && items.length === 0 && (
          <p className="py-6 text-center text-xs text-slate-400">No data</p>
        )}
        {!loading && items !== null && items.length > 0 && (
          activeTab === 'news'
            ? items.map((item, i) => <NewsRow key={i} item={item} />)
            : items.map((item, i) => <EventRow key={i} item={item} />)
        )}
      </div>
    </div>
  );
}
