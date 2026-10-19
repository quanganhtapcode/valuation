/** Age the server snapshot from its fetch time, including time spent in ISR. */
export function heatmapRefreshDelay(fetchedAt: number, interval: number, now = Date.now()): number {
    if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return 0;
    const age = Math.max(0, now - fetchedAt);
    return Math.max(0, interval - age);
}

/** Failed requests should recover promptly even outside market hours. */
export function heatmapRetryDelay(failures: number): number {
    return Math.min(15000, 2000 * 2 ** Math.min(Math.max(failures - 1, 0), 3));
}
