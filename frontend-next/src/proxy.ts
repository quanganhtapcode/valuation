import { NextRequest, NextResponse } from 'next/server';
const PUBLIC_FILE = /\.[^/]+$/;
const isLang = (value: string): value is 'vi' | 'en' => value === 'vi' || value === 'en';

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname === '/robots.txt' || pathname === '/sitemap.xml' || PUBLIC_FILE.test(pathname)) {
        return NextResponse.next();
    }

    // Locale preference is cookie-dependent; only explicit locale URLs share HTML caches.
    if (pathname === '/') {
        const preferred = request.cookies.get('lang')?.value;
        const url = request.nextUrl.clone();
        url.pathname = isLang(preferred || '') ? `/${preferred}` : '/vi';
        const response = NextResponse.redirect(url, 307);
        response.headers.set('Cache-Control', 'private, no-store');
        return response;
    }

    const parts = pathname.split('/');
    const locale = parts[1];
    if (!isLang(locale)) {
        const preferred = request.cookies.get('lang')?.value;
        const targetLocale = isLang(preferred || '') ? preferred : 'vi';
        const url = request.nextUrl.clone();
        url.pathname = `/${targetLocale}${pathname === '/' ? '' : pathname}`;
        const response = NextResponse.redirect(url, 307);
        response.headers.set('Cache-Control', 'private, no-store');
        return response;
    }

    return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
