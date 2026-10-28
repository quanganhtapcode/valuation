import { BACKEND_API } from '@/lib/backendApi.server';
import { proxyApiRequest } from '@/lib/apiProxy';

export async function GET(request: Request) {
    return proxyApiRequest(request, 'financials/fields', BACKEND_API);
}
