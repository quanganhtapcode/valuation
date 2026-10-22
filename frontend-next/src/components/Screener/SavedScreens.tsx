'use client';

import { useEffect, useState } from 'react';

type Screen = { name: string; query: string };
export default function SavedScreens({ query, apply, lang }: { query: string; apply: (query: string) => void; lang: 'vi' | 'en' }) {
  const [screens, setScreens] = useState<Screen[]>([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [url, setUrl] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      apply(window.location.search);
      try {
        const data: unknown = JSON.parse(localStorage.getItem('stock-screens-v1') ?? '[]');
        if (Array.isArray(data)) setScreens(data.filter((item): item is Screen => !!item && typeof item.name === 'string' && typeof item.query === 'string').slice(0, 20));
      } catch { setMessage(lang === 'vi' ? 'Không đọc được bộ lọc đã lưu.' : 'Unable to read saved screens.'); }
    }, 0);
    const restore = () => apply(window.location.search);
    window.addEventListener('popstate', restore);
    return () => { clearTimeout(timer); window.removeEventListener('popstate', restore); };
    // Restore browser state once after hydration; form edits must not trigger restoration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const persist = (next: Screen[]) => {
    try { localStorage.setItem('stock-screens-v1', JSON.stringify(next)); setScreens(next); return true; }
    catch { setMessage(lang === 'vi' ? 'Trình duyệt không cho phép lưu.' : 'Browser storage is unavailable.'); return false; }
  };
  return <details className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
    <summary className="cursor-pointer text-sm font-medium">{lang === 'vi' ? 'Lưu & chia sẻ bộ lọc' : 'Save & share screens'}{screens.length > 0 && <span className="ml-2 text-slate-500">({screens.length})</span>}</summary>
    <div className="mt-3">
    <div className="flex flex-wrap items-center gap-2">
      <input className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-transparent p-2 text-base dark:border-slate-600" aria-label={lang === 'vi' ? 'Tên bộ lọc' : 'Screen name'} placeholder={lang === 'vi' ? 'Tên bộ lọc…' : 'Screen name…'} maxLength={80} value={name} onChange={event => setName(event.target.value)} />
      <button className="rounded-lg bg-blue-600 min-h-11 px-3 py-2 text-sm text-white disabled:opacity-50" disabled={!name.trim()} onClick={() => {
        if (persist([{ name: name.trim(), query }, ...screens.filter(screen => screen.name !== name.trim())].slice(0, 20))) { setName(''); setMessage(lang === 'vi' ? 'Đã lưu trên trình duyệt này.' : 'Saved in this browser.'); }
      }}>{lang === 'vi' ? 'Lưu bộ lọc' : 'Save screen'}</button>
      <button className="rounded-lg border border-slate-300 min-h-11 px-3 py-2 text-sm dark:border-slate-600" onClick={async () => {
        const link = new URL(window.location.href); link.search = query;
        window.history.replaceState(window.history.state, '', link);
        setUrl(link.toString());
        try { await navigator.clipboard.writeText(link.toString()); setMessage(lang === 'vi' ? 'Đã sao chép liên kết.' : 'Link copied.'); }
        catch { setMessage(lang === 'vi' ? 'Sao chép liên kết trong ô bên dưới.' : 'Copy the link below.'); }
      }}>{lang === 'vi' ? 'Chia sẻ bộ lọc & so sánh' : 'Share screen & comparison'}</button>
      <button className="rounded-lg border border-slate-300 min-h-11 px-3 py-2 text-sm dark:border-slate-600" onClick={() => apply('revenue_growth_min=20&net_profit_growth_min=20&sort=revenue_growth')}>{lang === 'vi' ? 'Mẫu: tăng trưởng doanh thu & lợi nhuận ≥20%' : 'Preset: revenue & profit growth ≥20%'}</button>
    </div>
    <p className="mt-2 text-xs text-slate-500">{lang === 'vi' ? 'Tối đa 20 bộ lọc trên trình duyệt này; lưu cùng tên sẽ thay thế. Mẫu tăng trưởng dùng chỉ tiêu YoY của nguồn dữ liệu.' : 'Up to 20 screens in this browser; saving the same name replaces it. Growth preset uses source YoY metrics.'}</p>
    {url && <input className="mt-2 w-full rounded border bg-transparent p-2 text-xs" readOnly aria-label={lang === 'vi' ? 'Liên kết chia sẻ' : 'Share link'} value={url} onFocus={event => event.target.select()} />}
    <div className="mt-2 flex flex-wrap gap-2">{screens.map(screen => <div key={screen.name} className="rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-600"><button className="text-sm text-blue-600" onClick={() => apply(screen.query)}>{screen.name}</button><button className="ml-3" aria-label={`${lang === 'vi' ? 'Xóa' : 'Delete'} ${screen.name}`} onClick={() => persist(screens.filter(value => value.name !== screen.name))}>×</button></div>)}</div>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
    </div>
  </details>;
}
