import { isBulkExport, resolveCachePolicy } from './apiProxyPolicy';
import { apiError, proxyErrorPayload, proxyResponseHeaders } from './apiResponse';
import { backendApiPath } from './apiRouteRegistry';

export async function proxyApiRequest(request: Request, apiPath: string, backendApi: string) {
    const method = request.method;
    const { searchParams } = new URL(request.url);
    const query = searchParams.toString();
    const policy = resolveCachePolicy(apiPath, searchParams);
    let body: string | undefined;
    if (method === 'POST') {
        try {
            body = JSON.stringify(await request.json());
        } catch {
            return Response.json(apiError(400, 'Request body must be valid JSON'), {
                status: 400, headers: { 'Cache-Control': 'no-store' },
            });
        }
    }

    try {
        const response = await fetch(`${backendApi}/${backendApiPath(apiPath)}${query ? `?${query}` : ''}`, {
            method,
            headers: {
                'User-Agent': 'Next.js API Proxy',
                Accept: '*/*',
                ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
            },
            body,
            // Cache once at the CDN boundary. A second persistent fetch cache
            // could retain an upstream no-store response or extend its lifetime.
            cache: 'no-store',
            signal: AbortSignal.timeout(isBulkExport(apiPath) ? 120000 : 15000),
        });
        const headers = proxyResponseHeaders(response.headers,
            method === 'POST' || !response.ok ? 'no-store' : policy.responseCacheControl);
        headers.set('X-Proxy-Cache-Policy', `${policy.mode}:${policy.revalidateSeconds}`);

        if (!response.ok) {
            const payload: unknown = await response.json().catch(() => null);
            headers.set('Content-Type', 'application/json');
            headers.delete('ETag');
            headers.delete('Last-Modified');
            headers.delete('Content-Disposition');
            return Response.json(proxyErrorPayload(response.status, payload), {
                status: response.status, headers,
            });
        }
        // Preserve status and stream both JSON and downloads, including 204.
        return new Response(response.body, { status: response.status, headers });
    } catch (error) {
        const timedOut = error instanceof Error
            && (error.name === 'AbortError' || error.name === 'TimeoutError');
        if (!timedOut) console.error('API proxy request failed:', error);
        const status = timedOut ? 504 : 502;
        return Response.json(apiError(status, timedOut
            ? 'Backend request timed out' : 'Backend is unavailable'), {
            status, headers: { 'Cache-Control': 'no-store' },
        });
    }
}
