import { prefetchStockData } from './stockNavigationData';

export interface StockNavigationTarget {
    pathname: string;
    symbol: string;
    lang: 'vi' | 'en';
}

export function stockNavigationTarget(href: string, origin: string): StockNavigationTarget | null {
    try {
        const url = new URL(href, origin);
        if (url.origin !== origin) return null;
        const match = /^\/(vi|en)\/stock\/([a-z0-9]{1,10})\/?$/i.exec(url.pathname);
        return match ? { pathname: url.pathname, symbol: match[2].toUpperCase(), lang: match[1].toLowerCase() as 'vi' | 'en' } : null;
    } catch {
        return null;
    }
}

let pending: (StockNavigationTarget & { fromPath: string }) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export const getStockNavigation = () => pending;
export const getServerStockNavigation = () => null;
export function subscribeStockNavigation(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
export function cancelStockNavigation() {
    clearTimeout(timer);
    if (!pending) return;
    pending = null;
    emit();
}

/** Notify the shared shell synchronously, before Next starts its route request. */
export function startStockNavigation(href: string) {
    if (typeof window === 'undefined') return;
    const target = stockNavigationTarget(href, window.location.origin);
    if (!target || target.pathname === window.location.pathname) {
        cancelStockNavigation();
        return;
    }
    clearTimeout(timer);
    pending = { ...target, fromPath: window.location.pathname };
    emit();
    prefetchStockData(target.symbol);
    // Network failures must never leave the old page permanently hidden.
    timer = setTimeout(cancelStockNavigation, 15_000);
}

export function completeStockNavigation(pathname: string) {
    if (pending && (pending.pathname === pathname || (pathname !== pending.fromPath && !/^\/(vi|en)\/stock\//.test(pathname)))) {
        cancelStockNavigation();
    }
}
