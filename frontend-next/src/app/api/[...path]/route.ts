import { NextResponse } from 'next/server';

// ── API proxy target ────────────────────────────────────────────────────────
// Browser calls  : GET/POST /api/*  →  this file  →  BACKEND_API/*
// Domain mapping : stock.quanganh.org (Vercel) → api.quanganh.org (VPS nginx)
//
// Env vars to set:
//   BACKEND_API_URL       — production VPS URL  (set in Vercel dashboard)
//   BACKEND_API_URL_LOCAL — local Flask URL     (set in .env.local)
//
// See .env.production / .env.example for canonical values.
const BACKEND_API =
    process.env.NODE_ENV === 'development'
        ? (process.env.BACKEND_API_URL_LOCAL || 'http://127.0.0.1:8000/api')
        : (process.env.BACKEND_API_URL || 'https://api.quanganh.org/v1/valuation');

type ProxyCachePolicy = {
    mode: 'realtime' | 'short' | 'medium' | 'long';
    revalidateSeconds: number;
    responseCacheControl: string;
};

const REALTIME_PATH_PREFIXES = [
    'current-price/',
    'price/',
    'batch-price',
    'market/vci-indices',
    'market/top-movers',
    'market/heatmap',
];

const SHORT_CACHE_PATH_PREFIXES = [
    'valuation/',
    'market/news',
    'news/',
    'events/',
    'holders/',
    'stock/holders/',
];

const MEDIUM_CACHE_PATH_PREFIXES = [
    'historical-chart-data/',
    'stock/history/',
    'stock/',
    'app-data/',
    'market/pe-chart',
    'market/lottery',
];

const LONG_CACHE_PATH_PREFIXES = [
    'company/profile/',
    'tickers',
    'health',
];

function pathMatches(path: string, prefixes: string[]): boolean {
    return prefixes.some((prefix) => path === prefix || path.startsWith(prefix));
}

function resolveCachePolicy(apiPath: string, searchParams: URLSearchParams): ProxyCachePolicy {
    const normalized = (apiPath || '').toLowerCase();

    if (searchParams.get('cache') === 'no-store' || searchParams.get('nocache') === '1') {
        return {
            mode: 'realtime',
            revalidateSeconds: 0,
            responseCacheControl: 'no-store, no-cache, must-revalidate',
        };
    }

    if (pathMatches(normalized, REALTIME_PATH_PREFIXES)) {
        return {
            mode: 'realtime',
            revalidateSeconds: 0,
            responseCacheControl: 'no-store, no-cache, must-revalidate',
        };
    }

    if (pathMatches(normalized, SHORT_CACHE_PATH_PREFIXES)) {
        return {
            mode: 'short',
            revalidateSeconds: 30,
            responseCacheControl: 'public, s-maxage=30, stale-while-revalidate=60',
        };
    }

    if (pathMatches(normalized, LONG_CACHE_PATH_PREFIXES)) {
        return {
            mode: 'long',
            revalidateSeconds: 600,
            responseCacheControl: 'public, s-maxage=600, stale-while-revalidate=1200',
        };
    }

    if (pathMatches(normalized, MEDIUM_CACHE_PATH_PREFIXES)) {
        return {
            mode: 'medium',
            revalidateSeconds: 120,
            responseCacheControl: 'public, s-maxage=120, stale-while-revalidate=300',
        };
    }

    return {
        mode: 'short',
        revalidateSeconds: 45,
        responseCacheControl: 'public, s-maxage=45, stale-while-revalidate=90',
    };
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ path: string[] }> }
) {
    try {
        const { path } = await params;
        const apiPath = path.join('/');

        // Get query string from the request URL
        const { searchParams } = new URL(request.url);
        const queryString = searchParams.toString();
        const cachePolicy = resolveCachePolicy(apiPath, searchParams);

        const fullUrl = `${BACKEND_API}/${apiPath}${queryString ? `?${queryString}` : ''}`;

        const fetchOptions: RequestInit & { next?: { revalidate: number } } = {
            headers: {
                'User-Agent': 'Next.js API Proxy',
                'Accept': '*/*',
            },
        };

        if (cachePolicy.mode === 'realtime') {
            fetchOptions.cache = 'no-store';
        } else {
            fetchOptions.next = { revalidate: cachePolicy.revalidateSeconds };
        }

        const response = await fetch(fullUrl, fetchOptions);

        if (!response.ok) {
            let backendError: any = null;
            try {
                backendError = await response.json();
            } catch {
                backendError = null;
            }

            return NextResponse.json(
                {
                    error: `Backend Error: ${response.status}`,
                    backend: backendError,
                },
                { status: response.status }
            );
        }

        const backendSource = response.headers.get('x-source');
        const backendTiming = response.headers.get('server-timing');
        const backendDb = response.headers.get('x-db');
        const backendCache = response.headers.get('x-cache');
        const backendContentType = response.headers.get('content-type') || '';

        // JSON API response path (default)
        if (backendContentType.toLowerCase().includes('application/json')) {
            const data = await response.json();

            return NextResponse.json(data, {
                headers: {
                    'Cache-Control': cachePolicy.responseCacheControl,
                    ...(cachePolicy.mode === 'realtime'
                        ? {
                              'Pragma': 'no-cache',
                              'Expires': '0',
                          }
                        : {}),
                    'X-Proxy-Backend': BACKEND_API,
                    'X-Proxy-Cache-Policy': `${cachePolicy.mode}:${cachePolicy.revalidateSeconds}`,
                    ...(backendSource ? { 'X-Source': backendSource } : {}),
                    ...(backendTiming ? { 'Server-Timing': backendTiming } : {}),
                    ...(backendDb ? { 'X-DB': backendDb } : {}),
                    ...(backendCache ? { 'X-Cache': backendCache } : {}),
                },
            });
        }

        // Binary/file response path (downloads, etc.)
        const payload = await response.arrayBuffer();
        const passthroughHeaders = new Headers();

        passthroughHeaders.set('Cache-Control', cachePolicy.responseCacheControl);
        if (cachePolicy.mode === 'realtime') {
            passthroughHeaders.set('Pragma', 'no-cache');
            passthroughHeaders.set('Expires', '0');
        }
        passthroughHeaders.set('X-Proxy-Backend', BACKEND_API);
        passthroughHeaders.set('X-Proxy-Cache-Policy', `${cachePolicy.mode}:${cachePolicy.revalidateSeconds}`);

        const contentType = response.headers.get('content-type');
        const contentDisposition = response.headers.get('content-disposition');
        const contentLength = response.headers.get('content-length');

        if (contentType) passthroughHeaders.set('Content-Type', contentType);
        if (contentDisposition) passthroughHeaders.set('Content-Disposition', contentDisposition);
        if (contentLength) passthroughHeaders.set('Content-Length', contentLength);
        if (backendSource) passthroughHeaders.set('X-Source', backendSource);
        if (backendTiming) passthroughHeaders.set('Server-Timing', backendTiming);
        if (backendDb) passthroughHeaders.set('X-DB', backendDb);
        if (backendCache) passthroughHeaders.set('X-Cache', backendCache);

        return new NextResponse(payload, {
            status: response.status,
            headers: passthroughHeaders,
        });
    } catch (error) {
        console.error('API Proxy Error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch data from backend' },
            { status: 500 }
        );
    }
}
export async function POST(
    request: Request,
    { params }: { params: Promise<{ path: string[] }> }
) {
    try {
        const { path } = await params;
        const apiPath = path.join('/');
        const body = await request.json();

        const fullUrl = `${BACKEND_API}/${apiPath}`;

        const response = await fetch(fullUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Next.js API Proxy',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            let backendError: any = null;
            try {
                backendError = await response.json();
            } catch {
                backendError = null;
            }

            return NextResponse.json(
                {
                    error: `Backend Error: ${response.status}`,
                    backend: backendError,
                },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('API Proxy POST Error:', error);
        return NextResponse.json(
            { error: 'Failed to post data to backend' },
            { status: 500 }
        );
    }
}
