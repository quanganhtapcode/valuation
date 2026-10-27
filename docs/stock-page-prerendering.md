# Stock page generation and deployment storage

Stock pages use a small build-time set from `frontend-next/src/config/stockPrerender.ts`: 20 common large-cap tickers, each in Vietnamese and English. The list is a practical initial set, not a measured popularity ranking or current index membership. Only symbols still present in `public/ticker_data.json` are generated.

The stock layout keeps `dynamicParams = true`, `dynamic = 'force-static'`, and `revalidate = 300`. Valid symbols outside the initial set render on their first request and then use ISR caching. The first request can therefore be slower. Unknown symbols still return 404 through the existing catalogue validation and routing proxy.

The sitemap continues to include every catalogue symbol in both languages. Each stock page keeps its existing metadata, canonical URL, language alternates, and structured data, whether generated during the build or on request. Search Console does not require every URL to be generated during the build.

This reduces the output stored with each new deployment. On-demand pages still consume cache/storage as they are visited; this is not a fixed ceiling on runtime storage. The change does not remove retained deployments or their files from Vercel. Review Deployment Storage and retention separately, preserving the releases needed for rollback.

References: [Next.js generateStaticParams](https://nextjs.org/docs/app/api-reference/functions/generate-static-params), [Vercel Deployment Storage](https://vercel.com/docs/deployment-storage).
