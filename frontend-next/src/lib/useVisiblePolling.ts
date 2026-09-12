'use client';

import { useEffect } from 'react';

/** Serial polling that pauses in hidden tabs and refreshes on return. */
export function useVisiblePolling(
    refresh: () => Promise<unknown>,
    getDelay: () => number,
    immediate = true,
): void {
    useEffect(() => {
        let disposed = false;
        let running = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const schedule = () => {
            clearTimeout(timer);
            if (!disposed && document.visibilityState === 'visible') {
                timer = setTimeout(() => { void run(); }, getDelay());
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
        else schedule();
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            disposed = true;
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [refresh, getDelay, immediate]);
}
