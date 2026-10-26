# Search Console indexing fixes (2026-10-26)

## Findings and changes

The screenshot reports 510 redirects, 367 blocked URLs, five 404s, one soft 404,
1,281 crawled but unindexed URLs and 13 canonical disagreements. It does not
include the affected URL lists, so these counts cannot be attributed to specific
routes or confirmed resolved from the screenshot alone.

Public production checks found that `/vi/stock/INVALID999` returned HTTP 200.
Stock routes now check the maintained ticker catalogue in the proxy, before
Next.js loading boundaries can stream a success response. Unknown stocks rewrite
to the localized missing-page response with HTTP 404 and `X-Robots-Tag: noindex`.
Metadata also rejects unknown stocks rather than inventing an indexable fallback.

Legacy paths permanently redirect to `/vi/...`; the homepage `/` retains its
cookie-aware temporary language redirect. Lowercase stock symbols redirect to
uppercase in the same hop, preserving query parameters and explicit languages.
The company directory now renders the actual catalogue and stock links in HTML,
in both languages, instead of an under-development placeholder. The footer links
to the directory so crawlers can discover it from every page. English stock
metadata uses the catalogue's English name and sector.

Fund listing and detail pages now declare their own localized canonical and
reciprocal language alternates. Fund details share their data request with
metadata generation and permanently redirect lowercase symbols to uppercase.

The old blanket `/api/` robots exclusion prevented crawlers from loading public
JSON used during rendering. Robots now permits those requests; frontend API
responses carry `X-Robots-Tag: noindex` so JSON remains outside search results.
Open Graph images are crawlable. Static sitemap entries omit `lastmod` when no
real modification date is available; stock entries retain the catalogue mtime.

No database migration, dependency or environment variable is required. Deploy
the frontend changes together, including `next.config.mjs` and `src/proxy.ts`.

## Checks after deployment

1. Fetch `/robots.txt` through the public domain. Confirm the origin block no
   longer disallows `/api/` or Open Graph images. Cloudflare may cache or prepend
   its own robots content; purge a stale robots response if necessary. The
   `Google-Extended` rule controls Gemini usage and does not block Google Search.
2. Confirm an API response has `X-Robots-Tag: noindex`, while `/vi/stock/VCB`
   remains indexable with a matching canonical and both language alternates.
3. Confirm `/stock/vcb` redirects directly to `/vi/stock/VCB` with 308,
   `/en/stock/vcb` redirects to `/en/stock/VCB`, and an unknown stock returns 404
   for both browser and Googlebot user agents.
4. In Search Console, inspect representative URLs from each affected group
   using **Test live URL**, including rendered content and loaded resources.
   Submit `https://stock.quanganh.org/sitemap.xml` if it is not already submitted.
5. Use **Validate fix** for applicable corrected issues. Valid redirected aliases
   and genuinely missing URLs should remain excluded; do not redirect unrelated
   missing pages to the homepage or make them return 200 to clear the report.
6. Review the URL lists for the five reported 404s, the soft 404 and the canonical
   disagreements. Restore real missing content or redirect only where a relevant
   replacement exists. Compare Google-selected canonicals with declared ones.

Google must recrawl before reports update. Crawlability, content and sitemap
improvements cannot guarantee that every page will be indexed.

References: [Google crawl troubleshooting](https://developers.google.com/search/docs/crawling-indexing/troubleshoot-crawling-errors),
[robots meta and HTTP headers](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag),
[Google crawler controls](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers).
