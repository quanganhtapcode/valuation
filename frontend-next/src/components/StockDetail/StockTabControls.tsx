'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '@/lib/utils';

export interface StockTabControlOption {
    id: string;
    label: ReactNode;
}

interface StockTabDropdownProps {
    label: ReactNode;
    options: StockTabControlOption[];
    value: string;
    onChange: (value: string) => void;
    ariaLabel?: string;
}

/** Shared selector used by the toolbars throughout the stock detail tabs. */
export function StockTabDropdown({ label, options, value, onChange, ariaLabel }: StockTabDropdownProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onClickOutside = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
        };
        if (open) document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                aria-label={ariaLabel}
                aria-expanded={open}
                onClick={() => setOpen(current => !current)}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
                {label}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-gray-400" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>
            {open && (
                <div className="absolute left-0 top-full z-50 mt-1.5 min-w-[160px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    {options.map(option => (
                        <button
                            key={option.id}
                            type="button"
                            onClick={() => { onChange(option.id); setOpen(false); }}
                            className={cx(
                                'w-full px-3 py-2 text-left text-[13px] transition-colors',
                                value === option.id
                                    ? 'bg-gray-100 font-medium text-gray-900 dark:bg-slate-700 dark:text-white'
                                    : 'text-gray-600 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-700/60',
                            )}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

interface StockTabIconButtonProps {
    onClick: () => void;
    title: string;
    disabled?: boolean;
    children: ReactNode;
}

export function StockTabIconButton({ onClick, title, disabled = false, children }: StockTabIconButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            aria-label={title}
            disabled={disabled}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
        >
            {children}
        </button>
    );
}

export function DownloadIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    );
}
