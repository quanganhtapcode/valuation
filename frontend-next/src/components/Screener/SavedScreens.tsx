'use client';


import { localizedCopy } from '@/lib/localizedCopy';
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
      } catch { setMessage(localizedCopy[lang].components_Screener_SavedScreens.unableToReadSavedScreens); }
    }, 0);
    const restore = () => apply(window.location.search);
    window.addEventListener('popstate', restore);
    return () => { clearTimeout(timer); window.removeEventListener('popstate', restore); };
    // Restore browser state once after hydration; form edits must not trigger restoration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const persist = (next: Screen[]) => {
    try { localStorage.setItem('stock-screens-v1', JSON.stringify(next)); setScreens(next); return true; }
    catch { setMessage(localizedCopy[lang].components_Screener_SavedScreens.browserStorageIsUnavailable); return false; }
  };
  return <details className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
    <summary className="cursor-pointer text-sm font-medium">{localizedCopy[lang].components_Screener_SavedScreens.saveShareScreens}{screens.length > 0 && <span className="ml-2 text-slate-500">({screens.length})</span>}</summary>
    <div className="mt-3">
    <div className="flex flex-wrap items-center gap-2">
      <input className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-transparent p-2 text-base dark:border-slate-600" aria-label={localizedCopy[lang].components_Screener_SavedScreens.screenName} placeholder={localizedCopy[lang].components_Screener_SavedScreens.screenName2} maxLength={80} value={name} onChange={event => setName(event.target.value)} />
      <button className="rounded-lg bg-blue-600 min-h-11 px-3 py-2 text-sm text-white disabled:opacity-50" disabled={!name.trim()} onClick={() => {
        if (persist([{ name: name.trim(), query }, ...screens.filter(screen => screen.name !== name.trim())].slice(0, 20))) { setName(''); setMessage(localizedCopy[lang].components_Screener_SavedScreens.savedInThisBrowser); }
      }}>{localizedCopy[lang].components_Screener_SavedScreens.saveScreen}</button>
      <button className="rounded-lg border border-slate-300 min-h-11 px-3 py-2 text-sm dark:border-slate-600" onClick={async () => {
        const link = new URL(window.location.href); link.search = query;
        window.history.replaceState(window.history.state, '', link);
        setUrl(link.toString());
        try { await navigator.clipboard.writeText(link.toString()); setMessage(localizedCopy[lang].components_Screener_SavedScreens.linkCopied); }
        catch { setMessage(localizedCopy[lang].components_Screener_SavedScreens.copyTheLinkBelow); }
      }}>{localizedCopy[lang].components_Screener_SavedScreens.shareScreenComparison}</button>
      <button className="rounded-lg border border-slate-300 min-h-11 px-3 py-2 text-sm dark:border-slate-600" onClick={() => apply('revenue_growth_min=20&net_profit_growth_min=20&sort=revenue_growth')}>{localizedCopy[lang].components_Screener_SavedScreens.presetRevenueProfitGrowth20}</button>
    </div>
    <p className="mt-2 text-xs text-slate-500">{localizedCopy[lang].components_Screener_SavedScreens.upTo20ScreensInThis}</p>
    {url && <input className="mt-2 w-full rounded border bg-transparent p-2 text-xs" readOnly aria-label={localizedCopy[lang].components_Screener_SavedScreens.shareLink} value={url} onFocus={event => event.target.select()} />}
    <div className="mt-2 flex flex-wrap gap-2">{screens.map(screen => <div key={screen.name} className="rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-600"><button className="text-sm text-blue-600" onClick={() => apply(screen.query)}>{screen.name}</button><button className="ml-3" aria-label={`${localizedCopy[lang].components_Screener_SavedScreens.delete} ${screen.name}`} onClick={() => persist(screens.filter(value => value.name !== screen.name))}>×</button></div>)}</div>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
    </div>
  </details>;
}
