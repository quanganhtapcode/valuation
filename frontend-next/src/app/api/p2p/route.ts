import { BACKEND_API } from '@/lib/backendApi.server';
import { proxyApiRequest } from '@/lib/apiProxy';

// Compatibility for clients that still use the old frontend URL.
export async function GET(request: Request) {
    return proxyApiRequest(request, 'market/p2p', BACKEND_API);
}
