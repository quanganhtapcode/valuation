'use client';

import { useEffect } from 'react';

/** Serial polling that pauses in hidden tabs and refreshes on return. */
export function useVisiblePolling(
    refresh: () => Promise<unknown>,
    getDelay: () => number,
    immediate = true,
    initialFetchedAt?: number,
): void {
    useEffect(() => {
        let disposed = false;
        let running = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const schedule = (delay = getDelay()) => {
            clearTimeout(timer);
            if (!disposed && document.visibilityState === 'visible') {
                timer = setTimeout(() => { void run(); }, delay);
            }
        };
        const run = async () => {
            if (disposed || running || document.visibilityState !== 'visible') return;
            running = true;
            try { await refresh(); }
            finally { running = false; schedule(); }
        };
        const onVisibility = () => {
            clearTimeout(timer);
            if (document.visibilityState === 'visible') void run();
        };
        if (immediate) void run();
        else if (initialFetchedAt === undefined) schedule();
        else {
            const interval = getDelay();
            const age = Number.isFinite(initialFetchedAt) && initialFetchedAt > 0
                ? Math.max(0, Date.now() - initialFetchedAt) : interval;
            const remaining = Math.max(0, interval - age);
            if (remaining > 0) schedule(remaining);
            else void run();
        }
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            disposed = true;
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [refresh, getDelay, immediate, initialFetchedAt]);
}
