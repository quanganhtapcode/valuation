import { MetadataRoute } from 'next';
import { readFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { siteConfig } from '@/app/siteConfig';
import { localizedPath } from '@/lib/localePath';

export const revalidate = 86400;

function normalizeSymbol(raw: unknown): string {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

async function loadStockSymbols(): Promise<{ symbols: string[]; lastModified: Date }> {
  try {
    const filePath = path.join(process.cwd(), 'public', 'ticker_data.json');
    const [raw, fileStat] = await Promise.all([
      readFile(filePath, 'utf8'),
      stat(filePath),
    ]);
    const parsed = JSON.parse(raw);
    const tickers = Array.isArray(parsed?.tickers) ? parsed.tickers : [];
    const deduped = new Set<string>();

    for (const item of tickers) {
      const sym = normalizeSymbol(item?.symbol);
      if (sym) deduped.add(sym);
    }

    return {
      symbols: Array.from(deduped),
      lastModified: fileStat.mtime,
    };
  } catch {
    return {
      symbols: [],
      lastModified: new Date(),
    };
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const routes = [
    { path: '/', changeFrequency: 'daily', priority: 1.0 }, { path: '/overview', changeFrequency: 'daily', priority: 0.9 },
    { path: '/news', changeFrequency: 'hourly', priority: 0.8 }, { path: '/screener', changeFrequency: 'daily', priority: 0.85 },
    { path: '/macro', changeFrequency: 'daily', priority: 0.8 }, { path: '/foreign', changeFrequency: 'hourly', priority: 0.75 },
    { path: '/events', changeFrequency: 'daily', priority: 0.75 }, { path: '/earnings', changeFrequency: 'daily', priority: 0.7 },
    { path: '/downloads', changeFrequency: 'weekly', priority: 0.55 }, { path: '/company', changeFrequency: 'weekly', priority: 0.7 },
    { path: '/about', changeFrequency: 'monthly', priority: 0.4 }, { path: '/contact', changeFrequency: 'monthly', priority: 0.3 },
    { path: '/terms', changeFrequency: 'yearly', priority: 0.2 }, { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
    { path: '/disclaimer', changeFrequency: 'yearly', priority: 0.2 },
  ] as const;
  const staticRoutes: MetadataRoute.Sitemap = routes.flatMap(({ path: routePath, changeFrequency, priority }) => {
    const vi = `${siteConfig.url}${localizedPath(routePath, 'vi')}`;
    const en = `${siteConfig.url}${localizedPath(routePath, 'en')}`;
    const alternates = { languages: { 'vi-VN': vi, 'en-US': en, 'x-default': vi } };
    return [{ url: vi, lastModified: now, changeFrequency, priority, alternates }, { url: en, lastModified: now, changeFrequency, priority, alternates }];
  });

  const { symbols, lastModified: stockLastModified } = await loadStockSymbols();
  const stockRoutes: MetadataRoute.Sitemap = symbols.flatMap((symbol) => {
    const vi = `${siteConfig.url}${localizedPath(`/stock/${symbol}`, 'vi')}`;
    const en = `${siteConfig.url}${localizedPath(`/stock/${symbol}`, 'en')}`;
    const alternates = { languages: { 'vi-VN': vi, 'en-US': en, 'x-default': vi } };
    return [{ url: vi, lastModified: stockLastModified, changeFrequency: 'daily' as const, priority: 0.7, alternates }, { url: en, lastModified: stockLastModified, changeFrequency: 'daily' as const, priority: 0.7, alternates }];
  });

  return [...staticRoutes, ...stockRoutes];
}
