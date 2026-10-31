import { NextResponse } from 'next/server';
import { getP2PSnapshot } from '@/lib/p2pSource';

export const dynamic = 'force-dynamic';

export async function GET() {
    return NextResponse.json(await getP2PSnapshot(), { headers: { 'Cache-Control': 'no-store' } });
}
