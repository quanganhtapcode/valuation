'use client';

import { useLanguage } from '@/lib/languageContext';

interface PaginationProps {
    page: number;
    totalPages?: number;
    onPageChange: (page: number) => void;
    disabled?: boolean;
    hasNext?: boolean;
}

export default function Pagination({ page, totalPages, onPageChange, disabled = false, hasNext = true }: PaginationProps) {
    const { lang } = useLanguage();
    const previous = lang === 'vi' ? 'Trước' : 'Previous';
    const next = lang === 'vi' ? 'Sau' : 'Next';
    const buttonClass = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300 dark:disabled:hover:border-slate-700 dark:disabled:hover:bg-slate-950 dark:disabled:hover:text-slate-200';

    return (
        <nav aria-label={lang === 'vi' ? 'Phân trang' : 'Pagination'} className="flex items-center justify-center gap-3">
            <button type="button" className={buttonClass} onClick={() => onPageChange(page - 1)} disabled={disabled || page <= 1}>
                <span aria-hidden="true">←</span>{previous}
            </button>
            <span aria-live="polite" aria-atomic="true" className="min-w-14 text-center text-sm tabular-nums text-slate-500 dark:text-slate-400">
                {page}{totalPages !== undefined && ` / ${Math.max(1, totalPages)}`}
            </span>
            <button type="button" className={buttonClass} onClick={() => onPageChange(page + 1)} disabled={disabled || !hasNext || (totalPages !== undefined && page >= totalPages)}>
                {next}<span aria-hidden="true">→</span>
            </button>
        </nav>
    );
}
