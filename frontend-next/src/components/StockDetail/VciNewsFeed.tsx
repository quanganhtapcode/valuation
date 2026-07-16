'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/lib/languageContext';

type FeedTab = 'news' | 'dividend' | 'insider' | 'agm' | 'other';

// ── Tab config ────────────────────────────────────────────────────────────────

const TAB_LABELS: Record<'vi' | 'en', Record<FeedTab, string>> = {
  vi: { news: 'Tin tức', dividend: 'Cổ tức', insider: 'Giao dịch NB', agm: 'Đại hội CĐ', other: 'Sự kiện khác' },
  en: { news: 'News', dividend: 'Dividends', insider: 'Insider trades', agm: 'Shareholder meetings', other: 'Other events' },
};

// ── Event metadata ────────────────────────────────────────────────────────────

const EVENT_META: Record<string, { label: string; color: string; dot: string }> = {
  DIV:   { label: 'Cổ tức tiền mặt',  color: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30', dot: 'bg-emerald-500' },
  ISS:   { label: 'Phát hành cổ phần', color: 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30',            dot: 'bg-blue-500' },
  DDIND: { label: 'GD Cá nhân NB',     color: 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30',    dot: 'bg-violet-500' },
  DDINS: { label: 'GD Tổ chức NB',     color: 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30',    dot: 'bg-violet-500' },
  DDRP:  { label: 'Báo cáo',           color: 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800',          dot: 'bg-slate-400' },
  AGME:  { label: 'ĐHĐCĐ',             color: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30',        dot: 'bg-amber-500' },
  AGMR:  { label: 'Kết quả ĐHĐCĐ',    color: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30',        dot: 'bg-amber-500' },
  EGME:  { label: 'ĐHĐCĐ bất thường', color: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30',        dot: 'bg-amber-500' },
  AIS:   { label: 'Niêm yết bổ sung',  color: 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/30',               dot: 'bg-sky-500' },
  MA:    { label: 'M&A',               color: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30',            dot: 'bg-rose-500' },
  NLIS:  { label: 'Niêm yết mới',      color: 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/30',               dot: 'bg-sky-500' },
  SUSP:  { label: 'Tạm ngừng GD',      color: 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30',               dot: 'bg-red-500' },
  OTHE:  { label: 'Sự kiện khác',      color: 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800',         dot: 'bg-slate-400' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRelative(iso: string | null | undefined, lang: 'vi' | 'en'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return lang === 'vi' ? 'Hôm nay' : 'Today';
  if (diff === 1) return lang === 'vi' ? 'Hôm qua' : 'Yesterday';
  if (diff < 7) return lang === 'vi' ? `${diff} ngày trước` : `${diff} days ago`;
  return d.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'short', year: diff > 300 ? 'numeric' : undefined });
}

function fmtFull(iso: string | null | undefined, lang: 'vi' | 'en'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Icons (SVG — no emojis) ───────────────────────────────────────────────────

function IcoExternal() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
      <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
    </svg>
  );
}

function IcoNewspaper() {
  return (
    <svg className="w-8 h-8 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6V7.5z" />
    </svg>
  );
}

// ── Sentiment badge ───────────────────────────────────────────────────────────

function SentimentBadge({ score, label, lang }: { score?: number; label?: string; lang: 'vi' | 'en' }) {
  const raw = label?.toLowerCase() ?? '';
  const isPos = raw.includes('pos') || (score !== undefined && score > 0.15);
  const isNeg = raw.includes('neg') || (score !== undefined && score < -0.15);
  if (!label && score === undefined) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
      isPos ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
      isNeg ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400' :
              'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isPos ? 'bg-emerald-500' : isNeg ? 'bg-red-500' : 'bg-slate-400'}`} />
      {isPos ? (lang === 'vi' ? 'Tích cực' : 'Positive') : isNeg ? (lang === 'vi' ? 'Tiêu cực' : 'Negative') : (lang === 'vi' ? 'Trung lập' : 'Neutral')}
    </span>
  );
}

// ── NewsCard ──────────────────────────────────────────────────────────────────

function NewsCard({ item, lang }: { item: any; lang: 'vi' | 'en' }) {
  const title    = item.newsTitle ?? item.title ?? '';
  const date     = item.publicDate ?? item.publishDate ?? item.PublishDate;
  const img      = item.newsImageUrl ?? item.newsSmallImageUrl;
  const source   = item.newsSource ?? item.source ?? item.Source ?? 'VCI';
  const url      = item.newsSourceLink ?? item.newsUrl ?? item.newsLink ?? item.url ?? item.Link ?? '';
  const score    = item.sentimentScore ?? item.score ?? item.Score;
  const sentiment = item.sentimentLabel ?? item.Sentiment;
  const [imgErr, setImgErr] = useState(false);

  return (
    <a href={url || '#'} target="_blank" rel="noreferrer"
      className="group flex gap-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-blue-200 dark:hover:border-blue-800/60 transition-colors">

      {/* Thumbnail */}
      <div className="flex-shrink-0 w-[88px] h-[64px] rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800">
        {img && !imgErr ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={img} alt="" className="w-full h-full object-cover" onError={() => setImgErr(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <IcoNewspaper />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium leading-snug text-slate-800 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
          {title}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5">{source}</span>
          {date && <span className="text-[11px] text-slate-400 dark:text-slate-500">{fmtRelative(date, lang)}</span>}
          <SentimentBadge score={score} label={sentiment} lang={lang} />
          {url && <span className="ml-auto text-slate-300 dark:text-slate-600 group-hover:text-blue-400 transition-colors"><IcoExternal /></span>}
        </div>
      </div>
    </a>
  );
}

// ── EventCard ─────────────────────────────────────────────────────────────────

function EventCard({ item, lang }: { item: any; lang: 'vi' | 'en' }) {
  const code  = item.eventCode ?? '';
  const meta  = EVENT_META[code] ?? { label: code || 'Sự kiện', color: 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800', dot: 'bg-slate-400' };
  const title = item.eventTitleVi ?? item.eventTitleEn ?? item.eventNameVi ?? item.eventNameEn ?? '';
  const date1 = fmtFull(item.displayDate1 ?? item.publicDate, lang);
  const action = item.actionTypeEn ?? item.actionTypeVi;
  const value  = item.valuePerShare;
  const ratio  = item.exerciseRatio;
  const isBuy  = action === 'Buy' || action === 'Mua';
  const isSell = action === 'Sell' || action === 'Bán';

  return (
    <div className="flex gap-3.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      {/* Dot accent */}
      <div className="flex-shrink-0 mt-1">
        <div className={`w-2.5 h-2.5 rounded-full ring-4 ring-white dark:ring-slate-900 ${meta.dot}`} />
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug">{title}</p>
          <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${meta.color}`}>{meta.label}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          {date1 && <span>{date1}</span>}
          {action && (
            <span className={`font-semibold flex items-center gap-0.5 ${isBuy ? 'text-emerald-600 dark:text-emerald-400' : isSell ? 'text-red-500 dark:text-red-400' : ''}`}>
              {isBuy ? '▲' : isSell ? '▼' : ''} {action}
            </span>
          )}
          {value != null && (
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {Number(value).toLocaleString('vi-VN')} đ/CP
            </span>
          )}
          {ratio != null && value == null && (
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {(Number(ratio) * 100).toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="animate-pulse flex gap-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex-shrink-0 w-[88px] h-[64px] rounded-lg bg-slate-100 dark:bg-slate-800" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3.5 rounded-md bg-slate-100 dark:bg-slate-800 w-full" />
            <div className="h-3.5 rounded-md bg-slate-100 dark:bg-slate-800 w-4/5" />
            <div className="h-2.5 rounded-md bg-slate-100 dark:bg-slate-800 w-24 mt-1" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Empty / Error ─────────────────────────────────────────────────────────────

function EmptyState({ label, lang }: { label: string; lang: 'vi' | 'en' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
        <svg className="w-6 h-6 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{lang === 'vi' ? `Không có ${label.toLowerCase()}` : `No ${label.toLowerCase()} available`}</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{lang === 'vi' ? 'Chưa có dữ liệu cho mục này.' : 'There is no data for this section yet.'}</p>
    </div>
  );
}

function ErrorState({ message, lang }: { message: string; lang: 'vi' | 'en' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center mb-3">
        <svg className="w-6 h-6 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-red-600 dark:text-red-400">{lang === 'vi' ? 'Không tải được dữ liệu' : 'Unable to load data'}</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{message}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VciNewsFeed({ symbol }: { symbol: string }) {
  const { lang } = useLanguage();
  const [activeTab, setActiveTab] = useState<FeedTab>('news');
  const [data,    setData]    = useState<Partial<Record<FeedTab, any[]>>>({});
  const [loading, setLoading] = useState<Partial<Record<FeedTab, boolean>>>({});
  const [errors,  setErrors]  = useState<Partial<Record<FeedTab, string>>>({});

  const load = useCallback(async (tab: FeedTab) => {
    if (data[tab] !== undefined || loading[tab]) return;
    setLoading(p => ({ ...p, [tab]: true }));
    try {
      const res  = await fetch(`/api/stock/vci-feed/${symbol}?tab=${tab}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      setData(p => ({ ...p, [tab]: json.data ?? [] }));
    } catch (e: any) {
      setErrors(p => ({ ...p, [tab]: e.message }));
    } finally {
      setLoading(p => ({ ...p, [tab]: false }));
    }
  }, [symbol, data, loading]);

  useEffect(() => { load('news'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTab = (tab: FeedTab) => { setActiveTab(tab); load(tab); };

  const items   = data[activeTab];
  const isLoad  = loading[activeTab];
  const err     = errors[activeTab];
  const tabLabel = TAB_LABELS[lang][activeTab];
  const count   = items?.length;

  return (
    <div>
      {/* Shared stock-detail header */}
      <div className="flex w-full flex-col gap-3 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-tremor-title font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{lang === 'vi' ? 'Tin tức & Sự kiện' : 'News & Events'}</h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {isLoad ? (lang === 'vi' ? 'Đang tải…' : 'Loading…') : count !== undefined ? `${count} ${tabLabel.toLowerCase()}` : (lang === 'vi' ? 'Tin tức và sự kiện của doanh nghiệp' : 'Company news and events')}
          </p>
        </div>
        <span className="rounded-full bg-blue-50 dark:bg-blue-900/30 px-3 py-1 text-xs font-bold text-blue-600 dark:text-blue-400">
          {symbol.toUpperCase()}
        </span>
      </div>

      {/* Tab bar */}
      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-slate-100 pb-3 dark:border-slate-800">
        {(Object.keys(TAB_LABELS[lang]) as FeedTab[]).map(tab => (
          <button key={tab} onClick={() => handleTab(tab)}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors border ${
              activeTab === tab
                ? 'border-blue-500 bg-blue-600 text-white'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-blue-300 hover:text-blue-600 dark:hover:text-blue-400'
            }`}>
            {TAB_LABELS[lang][tab]}
            {data[tab] !== undefined && (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] ${
                activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
              }`}>
                {data[tab]!.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content — no inner scroll, let the page scroll */}
      <div className="pt-4 space-y-3">
        {isLoad && <Skeleton />}
        {!isLoad && err     && <ErrorState message={err} lang={lang} />}
        {!isLoad && !err && items !== undefined && items.length === 0 && <EmptyState label={tabLabel} lang={lang} />}
        {!isLoad && !err && items?.length ? (
          activeTab === 'news'
            ? items.map((item, i) => <NewsCard key={item.id ?? i} item={item} lang={lang} />)
            : items.map((item, i) => <EventCard key={item.id ?? i} item={item} lang={lang} />)
        ) : null}
      </div>
    </div>
  );
}
