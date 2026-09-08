import 'server-only';
import type { Lang } from '@/lib/translations';

const DETAILS_URL = 'https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/details';
const PROFILE_REVALIDATE_SECONDS = 60 * 60 * 24 * 30;

/** Share the existing persistent profile cache between HTML rendering and the API. */
export async function getCompanyProfile(symbol: string, lang: Lang, timeoutMs = 2000): Promise<string | null> {
    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return null;
    try {
        const response = await fetch(`${DETAILS_URL}?ticker=${encodeURIComponent(symbol)}`, {
            headers: {
                Accept: 'application/json',
                'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
                Origin: 'https://trading.vietcap.com.vn',
                Referer: 'https://trading.vietcap.com.vn/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
                'device-id': '7a3c8d9e1f20',
            },
            next: { revalidate: PROFILE_REVALIDATE_SECONDS },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return null;
        const payload = await response.json();
        const profile = lang === 'en' ? payload?.data?.enProfile : payload?.data?.profile;
        return typeof profile === 'string' && profile.trim() ? profile : null;
    } catch {
        // A cold/missing upstream response must not hold up the page indefinitely.
        return null;
    }
}

/** Render provider HTML as plain React text, including common/numeric entities. */
export function profileToText(profile: string | null): string {
    if (!profile) return '';
    const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return profile
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name: string) => {
            if (!name.startsWith('#')) return entities[name.toLowerCase()] ?? entity;
            const hex = name[1].toLowerCase() === 'x';
            const code = parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
        })
        .replace(/\s+/g, ' ')
        .trim();
}
