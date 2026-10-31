import { NextResponse } from 'next/server';
import { getP2PSnapshot } from '@/lib/p2pSource';
import { BACKEND_API } from '@/lib/backendApi.server';

export const dynamic = 'force-dynamic';

export async function GET() {
    const snapshot = await getP2PSnapshot();
    if (!snapshot.cashUsd) {
        try {
            const response = await fetch(`${BACKEND_API}/market/p2p/cash-usd`, {
                cache: 'no-store',
                signal: AbortSignal.timeout(4000),
                headers: { Origin: 'https://stock.quanganh.org', Referer: 'https://stock.quanganh.org/' },
            });
            if (response.ok) {
                const data = await response.json();
                if (Number.isFinite(data.buy) && data.buy > 0 && Number.isFinite(data.sell) && data.sell > 0 &&
                    Number.isFinite(data.fetchedAt) && data.fetchedAt <= Date.now() && Date.now() - data.fetchedAt <= 600_000) {
                    return NextResponse.json({ ...snapshot, cashUsd: { buy: data.buy, sell: data.sell } }, { headers: { 'Cache-Control': 'no-store' } });
                }
            }
        } catch {
            // Keep the source unavailable rather than showing an old quote.
        }
    }
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
}
