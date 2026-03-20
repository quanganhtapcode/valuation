This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Production env (API + WebSocket)

### Domain architecture

| Domain | Hosted on | Role |
|---|---|---|
| `stock.quanganh.org` | Vercel | This Next.js frontend |
| `api.quanganh.org` | VPS (nginx → Flask :8000) | REST + WebSocket backend |

### Traffic flow

```
Browser (stock.quanganh.org)
  ├─ REST  : GET /api/*  →  Next.js proxy (route.ts)  →  api.quanganh.org/v1/valuation/*
  └─ WS    : wss://api.quanganh.org/v1/valuation/ws/market/indices  (direct, bypasses Vercel)
```

### Environment variables

All values are documented in `.env.example`. The canonical production values live in `.env.production` (committed) and should also be set in the **Vercel dashboard**.

| Variable | Side | Purpose |
|---|---|---|
| `BACKEND_API_URL` | Server | URL the Next.js proxy forwards requests to |
| `BACKEND_API_URL_LOCAL` | Server (dev) | Local Flask URL for `npm run dev` |
| `NEXT_PUBLIC_API_URL` | Client | REST base URL — leave unset to use same-origin `/api` proxy |
| `NEXT_PUBLIC_BACKEND_WS_URL` | Client | WebSocket base URL — **required on Vercel** (no WS proxy) |

**Vercel dashboard** — set these two for `stock.quanganh.org`:
```
BACKEND_API_URL              = https://api.quanganh.org/v1/valuation
NEXT_PUBLIC_BACKEND_WS_URL   = wss://api.quanganh.org/v1/valuation
```

**Local dev** — copy `.env.example` to `.env.local` and adjust:
```bash
cp .env.example .env.local
# then edit BACKEND_API_URL_LOCAL if Flask runs on a different port
```
