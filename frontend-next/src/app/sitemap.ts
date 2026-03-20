import { MetadataRoute } from 'next';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { siteConfig } from '@/app/siteConfig';

function normalizeSymbol(raw: unknown): string {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

async function loadStockSymbols(): Promise<string[]> {
  try {
    const filePath = path.join(process.cwd(), 'public', 'ticker_data.json');
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const tickers = Array.isArray(parsed?.tickers) ? parsed.tickers : [];
    const deduped = new Set<string>();

    for (const item of tickers) {
      const sym = normalizeSymbol(item?.symbol);
      if (sym) deduped.add(sym);
    }

    return Array.from(deduped);
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: siteConfig.url,                  lastModified: now, changeFrequency: 'daily',   priority: 1.0 },
    { url: `${siteConfig.url}/overview`,    lastModified: now, changeFrequency: 'daily',   priority: 0.9 },
{ url: `${siteConfig.url}/news`,        lastModified: now, changeFrequency: 'hourly',  priority: 0.8 },
    { url: `${siteConfig.url}/company`,     lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    { url: `${siteConfig.url}/about`,       lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${siteConfig.url}/contact`,     lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${siteConfig.url}/terms`,       lastModified: now, changeFrequency: 'yearly',  priority: 0.2 },
    { url: `${siteConfig.url}/privacy`,     lastModified: now, changeFrequency: 'yearly',  priority: 0.2 },
    { url: `${siteConfig.url}/disclaimer`,  lastModified: now, changeFrequency: 'yearly',  priority: 0.2 },
  ];

  const symbols = await loadStockSymbols();
  const stockRoutes: MetadataRoute.Sitemap = symbols.map((symbol) => ({
    url: `${siteConfig.url}/stock/${symbol}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  return [...staticRoutes, ...stockRoutes];
}
