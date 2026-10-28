import 'server-only';
import type { Lang } from '@/lib/translations';
import { BACKEND_API } from './backendApi.server';
import { backendRequestHeaders } from './backendRequestHeaders';

/** Compatibility adapter; the central backend owns profile fetching and caching. */
export async function getCompanyProfile(symbol: string, lang: Lang, timeoutMs = 2000): Promise<string | null> {
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return null;
    try {
        const response = await fetch(`${BACKEND_API}/companies/${encodeURIComponent(symbol)}/description?lang=${lang}`, {
            headers: { ...backendRequestHeaders, Accept: 'application/json' },
            cache: 'no-store',
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return null;
        const payload = await response.json();
        const profile = payload?.profile;
        return typeof profile === 'string' && profile.trim() ? profile : null;
    } catch {
        // A cold/missing upstream response must not hold up the page indefinitely.
        return null;
    }
}

export { profileToText } from './profileText';
