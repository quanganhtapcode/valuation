'use client';

import { useLanguage } from '@/contexts/LanguageContext';

export default function FundsTabs({ value, onChange }: { value: 'nav' | 'compare'; onChange: (value: 'nav' | 'compare') => void }) {
    const { lang } = useLanguage();
    return <div role="tablist" aria-label={lang === 'vi' ? 'Thông tin quỹ' : 'Fund information'} className="flex gap-6 border-b border-slate-200 dark:border-slate-800" onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 'nav' : event.key === 'End' ? 'compare' : value === 'nav' ? 'compare' : 'nav';
            onChange(next);
            event.currentTarget.querySelector<HTMLButtonElement>(`#fund-tab-${next}`)?.focus();
        }
    }}>{(['nav', 'compare'] as const).map(tab => <button key={tab} id={`fund-tab-${tab}`} role="tab" aria-selected={value === tab} aria-controls={`fund-panel-${tab}`} tabIndex={value === tab ? 0 : -1} onClick={() => onChange(tab)} className={`border-b-2 px-1 py-3 text-sm font-semibold ${value === tab ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400' : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'}`}>{tab === 'nav' ? 'NAV' : lang === 'vi' ? 'So sánh' : 'Compare'}</button>)}</div>;
}
