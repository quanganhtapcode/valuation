# Frontend data and sidebar structure

`frontend-next/src/lib/api.ts` is the compatibility entry point for existing
imports. Put new requests and response types in the relevant feature module;
feature modules should import `apiCore` or another feature module directly,
not import the compatibility entry point.

| Module | Responsibility |
| --- | --- |
| `apiCore.ts` | Endpoint configuration and shared HTTP requests |
| `stockApi.ts` | Stock requests |
| `marketRealtime.ts` | Domestic market streams |
| `overviewApi.ts` | Overview snapshots and top movers |
| `newsApi.ts` | Market news |
| `foreignFlowApi.ts` | Foreign investor flow and intraday volume |
| `valuationChartApi.ts` | P/E and P/B history, parsing and statistics |
| `screenerApi.ts` | Screener filters, results and sectors |
| `goldApi.ts`, `lotteryApi.ts` | Gold prices and lottery results |
| `earningsApi.ts`, `aiInsightsApi.ts` | Earnings and generated analysis |
| `polymarketApi.ts` | Polymarket event selection and probability normalization |
| `dateFormatters.ts`, `numberFormatters.ts` | Shared presentation helpers |

## Sidebar

`SidebarCard` owns the common container and heading for Polymarket, OKX,
world markets, forex and gold. Each card owns its content and loading state.
`MarketChange` owns signed movement formatting, light/dark colors and missing
values. Zero is neutral; missing or non-finite values render as a dash.

`useOkxTickers` owns the OKX subscription, ticker state, reconnect backoff and
connection cleanup. `CryptoPrices` owns presentation. World markets and forex
continue to use the shared connection in `ffWS.ts`.

## Polymarket

The dedicated Next.js route at `app/api/market/polymarket-events/route.ts`
fetches and deduplicates upstream events with a five-minute cache and a
10-second upstream timeout. The generic Flask proxy no longer handles this
external source.

The client selects up to three events and three outcomes per event. Probability
is shown as a percentage; the existing daily price difference is multiplied by
100 and displayed in percentage points (`pp`). This differs from the relative
percentage change used for asset prices. Missing movement is never replaced
with zero.

Polling uses `useVisiblePolling`: requests run serially every five minutes,
pause in hidden tabs and refresh on return. A failed refresh preserves the
last successful data and shows a retry notice.

## Validation

Run `npm run lint`, `npx tsc --noEmit` and `npm run build` from `frontend-next`.
The build configuration skips type validation, so the separate TypeScript
check is required when refactoring exports or moving modules.
