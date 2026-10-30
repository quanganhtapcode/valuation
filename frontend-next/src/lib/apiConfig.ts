// One public REST origin for browser data and exports. /api remains a local
// development / rollback option and a compatibility endpoint for older clients.
export const API_BASE = (
    process.env.NEXT_PUBLIC_API_BASE_URL
    || (process.env.NODE_ENV === 'production' ? 'https://trading-api.quanganh.org/v1/valuation' : '/api')
).trim().replace(/\/+$/, '');
export const REALTIME_API_BASE = API_BASE;

/** Resolve a resource path without hardcoding a deployment host in components. */
export function apiUrl(path: string): string {
    const resource = path.replace(/^\/api(?:\/|$)/, '').replace(/^\/+/, '');
    return `${API_BASE}/${resource}`;
}

/** Backend manifests may contain relative API URLs or signed storage URLs. */
export function resolveApiLink(url: string): string {
    return url.startsWith('/api/') ? apiUrl(url) : url;
}

