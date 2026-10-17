export interface ApiErrorResponse {
    success: false;
    error: { code: string; message: string };
}

const errorCodes: Record<number, string> = {
    400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
    405: 'METHOD_NOT_ALLOWED', 408: 'REQUEST_TIMEOUT', 409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE', 429: 'RATE_LIMITED', 500: 'INTERNAL_ERROR',
    502: 'UPSTREAM_ERROR', 503: 'SERVICE_UNAVAILABLE', 504: 'GATEWAY_TIMEOUT',
};

export function apiError(status: number, message: string): ApiErrorResponse {
    return { success: false, error: { code: errorCodes[status] || 'REQUEST_FAILED', message } };
}

export function proxyErrorPayload(status: number, payload: unknown): ApiErrorResponse {
    if (payload && typeof payload === 'object') {
        const value = payload as { error?: unknown; message?: unknown };
        if (value.error && typeof value.error === 'object') {
            const error = value.error as { code?: unknown; message?: unknown };
            if (typeof error.code === 'string' && typeof error.message === 'string') {
                return { success: false, error: { code: error.code, message: error.message } };
            }
        }
        const message = typeof value.error === 'string' ? value.error : value.message;
        if (typeof message === 'string' && message) return apiError(status, message);
    }
    return apiError(status, `Backend request failed (${status})`);
}

export function proxyResponseHeaders(upstream: Headers, cacheControl: string): Headers {
    const headers = new Headers();
    for (const name of ['content-type', 'content-disposition', 'etag', 'last-modified',
        'retry-after', 'vary', 'server-timing', 'x-source', 'x-cache', 'x-db']) {
        const value = upstream.get(name);
        if (value) headers.set(name, value);
    }
    const restriction = upstream.get('cache-control');
    // Never weaken a privacy restriction or exceed either freshness limit.
    let effective = cacheControl;
    if (cacheControl !== 'no-store' && restriction) {
        if (/(?:^|,)\s*(?:private|no-store|no-cache)\b/i.test(restriction)) {
            effective = restriction;
        } else {
            const ttl = /(?:^|,)\s*s-maxage=(\d+)/i.exec(cacheControl)?.[1];
            const upstreamTtl = /(?:^|,)\s*s-maxage=(\d+)/i.exec(restriction)?.[1]
                ?? /(?:^|,)\s*max-age=(\d+)/i.exec(restriction)?.[1];
            effective = restriction;
            if (ttl && upstreamTtl) {
                const browserTtl = /(?:^|,)\s*max-age=(\d+)/i.exec(restriction)?.[1];
                const directives = restriction.split(',').map(value => value.trim())
                    .filter(value => !/^(?:s-maxage|max-age)=/i.test(value));
                directives.push(`max-age=${Math.min(Number(ttl), Number(browserTtl || 0))}`);
                directives.push(`s-maxage=${Math.min(Number(ttl), Number(upstreamTtl))}`);
                effective = directives.join(', ');
            }
        }
    }
    headers.set('Cache-Control', effective);
    // fetch transparently decompresses bodies, so upstream compressed lengths
    // and content encodings must not be reused. Streaming needs neither header.
    return headers;
}
