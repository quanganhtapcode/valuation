import { promises as fs } from 'node:fs';
import path from 'node:path';
import { apiError } from '@/lib/apiResponse';

export const dynamic = 'force-dynamic';

export async function GET() {
    const filePath = path.resolve(process.cwd(), '..', 'config', 'vci_field_codes.json');
    try {
        const body = await fs.readFile(filePath, 'utf8');
        return new Response(body, {
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=86400' },
        });
    } catch {
        return Response.json(apiError(404, 'Financial field-code map is unavailable'), {
            status: 404, headers: { 'Cache-Control': 'no-store' },
        });
    }
}
