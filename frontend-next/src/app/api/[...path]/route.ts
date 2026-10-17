import { BACKEND_API } from '@/lib/backendApi.server';
import { proxyApiRequest } from '@/lib/apiProxy';

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: Request, context: RouteContext) {
    const { path } = await context.params;
    return proxyApiRequest(request, path.join('/'), BACKEND_API);
}

export const GET = proxy;
export const POST = proxy;
