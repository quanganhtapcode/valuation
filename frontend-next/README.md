# Frontend Next.js

Next.js 16 + React 19 frontend for the Vietnamese stock valuation platform.
Routes live in `src/app`, reusable UI in `src/components`, and API clients,
types and browser utilities in `src/lib`.

## Commands

```bash
npm run dev
npm run lint
npm run build
npm run start
```

From the repository root:

```bash
npm run start-frontend
```

## Runtime Architecture

The browser uses same-origin REST calls through the Next.js proxy:

```text
Browser -> /api/* -> src/app/api/[...path]/route.ts -> Flask backend
```

WebSocket traffic bypasses Vercel and connects directly to the VPS:

```text
Browser -> NEXT_PUBLIC_BACKEND_WS_URL/ws/*
```

Production values:

```text
BACKEND_API_URL=https://api.quanganh.org/v1/valuation
NEXT_PUBLIC_BACKEND_WS_URL=wss://api.quanganh.org/v1/valuation
```

Local development usually uses:

```text
BACKEND_API_URL_LOCAL=http://127.0.0.1:8000/api
NEXT_PUBLIC_BACKEND_WS_URL=ws://127.0.0.1:8000
```

Copy `.env.example` to `.env.local` for local overrides. Production values are
also mirrored in the Vercel dashboard.

## Important Paths

| Path | Purpose |
|---|---|
| `src/app/page.tsx` | Main overview page |
| `src/app/stock/[symbol]/page.tsx` | Stock detail route |
| `src/app/api/[...path]/route.ts` | Backend proxy route |
| `src/components/StockDetail/` | Overview, financials, valuation, holders and price-history tabs |
| `src/components/Sidebar/` | Market pulse widgets |
| `src/lib/api.ts` | Shared API fetchers, WebSocket handlers and formatters |
| `src/lib/stockApi.ts` | Stock-specific API calls |
| `src/lib/reportGenerator.ts` | Excel export generation |
| `public/ticker_data.json` | Static ticker metadata used by frontend and Excel updater |

## Verification

For frontend changes, run:

```bash
npm run lint
npm run build
```

For proxy or WebSocket changes, also smoke-test against a running backend:

```bash
curl -s http://127.0.0.1:3000/api/health
curl -s http://127.0.0.1:3000/api/market/vci-indices
```
