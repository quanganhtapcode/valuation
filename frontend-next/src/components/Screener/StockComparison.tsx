'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchScreener, type ScreenerItem } from '@/lib/screenerApi';
import { localizedPath } from '@/lib/localePath';

const metrics: { key: keyof ScreenerItem; vi: string; en: string; unit: string; scale?: number }[] = [
  { key: 'marketPrice', vi: 'Giá', en: 'Price', unit: 'VND' },
  { key: 'marketCap', vi: 'Vốn hóa (tỷ VND)', en: 'Market cap (bn VND)', unit: '', scale: 1e9 },
  { key: 'ttmPe', vi: 'P/E', en: 'P/E', unit: '×' },
  { key: 'ttmPb', vi: 'P/B', en: 'P/B', unit: '×' },
  { key: 'ttmRoe', vi: 'ROE', en: 'ROE', unit: '%' },
  { key: 'netMargin', vi: 'Biên lợi nhuận ròng', en: 'Net margin', unit: '%' },
  { key: 'grossMargin', vi: 'Biên lợi nhuận gộp', en: 'Gross margin', unit: '%' },
  { key: 'revenueGrowthYoy', vi: 'Tăng trưởng doanh thu YoY', en: 'Revenue growth YoY', unit: '%' },
  { key: 'npatmiGrowthYoyQm1', vi: 'Tăng trưởng lợi nhuận YoY', en: 'Profit growth YoY', unit: '%' },
];

export default function StockComparison({ symbols, lang, onRemove }: { symbols: string[]; lang: 'vi' | 'en'; onRemove: (symbol: string) => void }) {
  const [result, setResult] = useState<{ items: ScreenerItem[]; error?: string; key: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [pair, setPair] = useState<[string, string]>(['', '']);
  const tickers = symbols.join(',');
  const key = `${tickers}:${lang}:${retry}`;
  useEffect(() => {
    if (!tickers || !open) return;
    let active = true;
    void fetchScreener({ filters: { tickers }, pageSize: 10 }).then(response => {
      if (!response.success) throw new Error('Comparison unavailable');
      if (active) setResult({ items: response.items, key });
    }).catch(() => {
      if (active) setResult({ items: [], key, error: lang === 'vi' ? 'Không tải được dữ liệu so sánh.' : 'Unable to load comparison.' });
    });
    return () => { active = false; };
  }, [key, tickers, lang, open]);
  if (!symbols.length) return null;
  const current = result?.key === key ? result : null;
  const rows = symbols.map(symbol => current?.items.find(item => item.ticker === symbol));
  const left = symbols.includes(pair[0]) ? pair[0] : symbols[0];
  const right = symbols.includes(pair[1]) && pair[1] !== left ? pair[1] : symbols.find(symbol => symbol !== left);
  const mobileSymbols = [left, right].filter((symbol): symbol is string => !!symbol);
  const renderTable = (visibleSymbols: string[], mobile: boolean) => <table className="w-full table-fixed text-sm">
    <thead><tr className="border-b border-slate-200 dark:border-slate-700">
      <th className={`${mobile ? 'w-[42%]' : 'w-56'} px-3 py-3 text-left font-medium text-slate-500`}>{lang === 'vi' ? 'Chỉ tiêu' : 'Metric'}</th>
      {visibleSymbols.map(symbol => <th key={symbol} className="px-2 py-3 text-right"><Link className="text-blue-600 dark:text-blue-400" href={localizedPath(`/stock/${symbol}`, lang)}>{symbol}</Link></th>)}
    </tr></thead>
    <tbody>{metrics.map(metric => {
      const values = rows.map(row => row?.[metric.key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const low = Math.min(...values), high = Math.max(...values);
      return <tr key={metric.key} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
        <th className="px-3 py-3 text-left font-normal leading-5 text-slate-600 dark:text-slate-300">{lang === 'vi' ? metric.vi : metric.en}{metric.unit && <span className="ml-1 text-xs text-slate-500">({metric.unit})</span>}</th>
        {visibleSymbols.map(symbol => {
          const value = current?.items.find(item => item.ticker === symbol)?.[metric.key];
          const valid = typeof value === 'number' && Number.isFinite(value);
          return <td key={symbol} className={`px-2 py-3 text-right font-medium tabular-nums ${valid && low !== high ? value === high ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200' : value === low ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : '' : ''}`}>{valid ? (value / (metric.scale ?? 1)).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 2 }) : '—'}</td>;
        })}
      </tr>;
    })}</tbody>
  </table>;
  return <section className="overflow-hidden rounded-xl border border-blue-200 bg-white dark:border-blue-900 dark:bg-slate-900" aria-label={lang === 'vi' ? 'So sánh cổ phiếu' : 'Stock comparison'}>
    <div className="flex flex-wrap items-center gap-2 p-3">
      <span className="mr-auto text-sm font-semibold">{lang === 'vi' ? 'Đã chọn' : 'Selected'} {symbols.length}/5</span>
      <button className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={symbols.length < 2} onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls="stock-comparison-content">{open ? (lang === 'vi' ? 'Đóng so sánh' : 'Close comparison') : (lang === 'vi' ? 'So sánh đã chọn' : 'Compare selected')}</button>
      <div className="flex w-full flex-wrap gap-2">{symbols.map(symbol => <button key={symbol} onClick={() => onRemove(symbol)} className="flex min-h-10 items-center gap-3 rounded-lg bg-slate-100 px-3 text-sm font-medium dark:bg-slate-800" aria-label={`${lang === 'vi' ? 'Bỏ' : 'Remove'} ${symbol}`}>{symbol}<span aria-hidden="true" className="text-slate-500">×</span></button>)}</div>
      {symbols.length < 2 && <p className="text-sm text-slate-500">{lang === 'vi' ? 'Chọn thêm một mã để so sánh.' : 'Select one more stock to compare.'}</p>}
    </div>
    {open && symbols.length >= 2 && <div id="stock-comparison-content" className="border-t border-slate-200 dark:border-slate-700">
      <div className="p-3">
        <h2 className="font-semibold">{lang === 'vi' ? 'So sánh cổ phiếu' : 'Stock comparison'}</h2>
        <p className="mt-1 text-sm leading-5 text-slate-500">{lang === 'vi' ? 'Xanh: cao nhất · Vàng: thấp nhất trong nhóm đã chọn. Màu không biểu thị tốt/xấu.' : 'Blue: highest · Amber: lowest in your selection. Colors are not quality ratings.'}</p>
      </div>
      {current?.error ? <p role="alert" className="p-3">{current.error} <button className="min-h-11 px-3 underline" onClick={() => setRetry(value => value + 1)}>{lang === 'vi' ? 'Thử lại' : 'Retry'}</button></p> : !current ? <p role="status" className="p-3">{lang === 'vi' ? 'Đang tải…' : 'Loading…'}</p> : <>
        <div className="md:hidden">
          {symbols.length > 2 && <div className="grid grid-cols-2 gap-3 px-3 pb-3">{([left, right] as const).map((symbol, index) => <label key={index} className="text-xs text-slate-500">{lang === 'vi' ? `Cổ phiếu ${index + 1}` : `Stock ${index + 1}`}<select aria-label={lang === 'vi' ? `Cổ phiếu ${index + 1}` : `Stock ${index + 1}`} value={symbol} onChange={event => setPair(index === 0 ? [event.target.value, right === event.target.value ? left : right ?? ''] : [left, event.target.value])} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white">{symbols.filter(value => index === 0 || value !== left).map(value => <option key={value}>{value}</option>)}</select></label>)}</div>}
          {renderTable(mobileSymbols, true)}
        </div>
        <div className="hidden md:block">{renderTable(symbols, false)}</div>
      </>}
      {current && !current.error && rows.some(row => !row) && <p className="p-3 text-sm text-amber-700 dark:text-amber-300">{lang === 'vi' ? 'Không có dữ liệu: ' : 'Unavailable: '}{symbols.filter((_, index) => !rows[index]).join(', ')}</p>}
    </div>}
  </section>;
}
