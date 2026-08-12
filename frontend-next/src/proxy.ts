import { NextRequest, NextResponse } from 'next/server';
const PUBLIC_FILE = /\.[^/]+$/;
const isLang = (value: string): value is 'vi' | 'en' => value === 'vi' || value === 'en';

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname === '/robots.txt' || pathname === '/sitemap.xml' || PUBLIC_FILE.test(pathname)) {
        return NextResponse.next();
    }

    const parts = pathname.split('/');
    const locale = parts[1];
    if (!isLang(locale)) {
        const preferred = request.cookies.get('lang')?.value;
        const targetLocale = isLang(preferred || '') ? preferred : 'vi';
        const url = request.nextUrl.clone();
        url.pathname = `/${targetLocale}${pathname === '/' ? '' : pathname}`;
        return NextResponse.redirect(url, 308);
    }

    const url = request.nextUrl.clone();
    url.pathname = `/${parts.slice(2).join('/')}`;
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-site-locale', locale);
    const response = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    response.cookies.set('lang', locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
    return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
