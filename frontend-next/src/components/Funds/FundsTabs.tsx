'use client';

import { useLanguage } from '@/contexts/LanguageContext';

export default function FundsTabs({ value, onChange }: { value: 'nav' | 'compare'; onChange: (value: 'nav' | 'compare') => void }) {
    const { lang } = useLanguage();
    return <div role="tablist" aria-label={lang === 'vi' ? 'Thông tin quỹ' : 'Fund information'} className="mt-5 flex overflow-x-auto border-b border-slate-200 dark:border-slate-800" onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 'nav' : event.key === 'End' ? 'compare' : value === 'nav' ? 'compare' : 'nav';
            onChange(next);
            event.currentTarget.querySelector<HTMLButtonElement>(`#fund-tab-${next}`)?.focus();
        }
    }}>{(['nav', 'compare'] as const).map(tab => <button type="button" key={tab} id={`fund-tab-${tab}`} role="tab" aria-selected={value === tab} aria-controls={`fund-panel-${tab}`} tabIndex={value === tab ? 0 : -1} onClick={() => onChange(tab)} className={`shrink-0 border-b-2 px-5 py-3 text-base font-semibold transition-colors ${value === tab ? 'border-blue-600 text-blue-700 dark:text-blue-400' : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'}`}>{tab === 'nav' ? 'NAV' : lang === 'vi' ? 'So sánh' : 'Compare'}</button>)}</div>;
}
