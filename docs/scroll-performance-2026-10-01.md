# Stock chart and website scroll performance

Chart implementation: commit `94fb6cc`, pushed to `origin/main`.

The stock chart uses TradingView's `lightweight-charts` package (declared ^5.1.0), renders with Canvas, and receives our OHLCV data. The React component owns the tooltip, history loading, theme, and resize handling. This is the open-source chart library, rather than the embedded TradingView website widget.

## Browser measurements

Production Next.js build served separately at localhost:3107. Playwright drove Chromium 153 headless on this VPS, using actual FPT history responses. Measurements sample requestAnimationFrame intervals and PerformanceObserver long tasks (>50 ms); they are not a GPU trace or a guarantee of physical-device FPS. Runs started after page load, so these values exclude startup/hydration. Pan measurements include waiting for history responses.

Desktop viewport 1440 x 900:

| Interaction | Samples | Median frame interval | P95 | Intervals >33.4 ms | Long tasks |
| --- | ---: | ---: | ---: | ---: | ---: |
| Page wheel scrolling | 224 | 16.7 ms | 16.8 ms | 1 | 0 |
| Six chart drag gestures, including history loading | 667 | 16.7 ms | 16.8 ms | 1 | 0 |

History requests progressed from 1Y to 2Y to 5Y. No page JavaScript exceptions. Screenshot inspected: candles and volume rendered correctly. This confirms history expansion works; it does not instrument the exact half-viewport crossing or verify the visible-range restoration numerically.

Mobile-sized viewport 390 x 844 with CPU throttled 4x (mouse input, not physical touch emulation):

| Interaction | Samples | Median frame interval | P95 | Intervals >33.4 ms | Long tasks |
| --- | ---: | ---: | ---: | ---: | --- |
| Page wheel scrolling | 215 | 16.7 ms | 33.4 ms | 10 | None |
| Six chart drag gestures, including history loading | 1166 | 16.7 ms | 16.8 ms | 14 | 50, 53, 105, 50 ms |

The page reached scrollY 3640, confirming actual page movement. History advanced to 2Y, with no JavaScript exceptions. CPU-throttled scrolling shows occasional frame delays; chart interactions include long tasks that need a trace to attribute precisely. The high proportion of idle frames during network waits can make chart P95 look better than active interaction alone.

## Recommended work, in order

1. Profile chart history expansion on slow CPUs. `normalizeData` parses dates during multiple sorts; every history expansion rebuilds all tooltip entries and calls `setData` on both complete series. Parse timestamps/day keys once, remove the redundant second sort, and profile the result before changing the data update strategy. Keep the logical range restoration when prepending history. Incremental `update` is suitable for a latest-session change, but should not be blindly used to prepend older bars.
2. Reduce scroll-related React work. `src/lib/use-scroll.ts` calls a state setter on every scroll event; React can bail out for identical booleans, so this alone is not proof of a bottleneck. Only publish changes when the threshold boolean changes, clean up listeners, and avoid reading layout after writes. Passive listeners matter most for cancelable wheel/touch events, rather than the noncancelable scroll event.
3. A/B test the fixed navbar's `backdrop-blur-xl`, plus tooltip shadows. Blur over moving content may increase compositing cost, but no cause has been isolated here. Compare traces with blur disabled, especially on real phones, before changing the design.
4. For long history/financial tables, use pagination or virtualization. Consider `content-visibility: auto` with stable intrinsic sizing for independent below-fold sections. Avoid putting containment on a parent of sticky navigation or a Canvas chart without verifying sizing, focus, and scroll anchoring.
5. Keep native wheel/touch scrolling as the baseline. Existing `html { scroll-behavior: smooth; }` smooths programmatic/anchor scrolling; it does not resolve rendering stalls during wheel scrolling. A JavaScript smooth-scroll library changes input feel but adds per-frame work and must be tested for chart zoom, nested tables, keyboard input, and reduced-motion preferences.
6. Validate on physical Android and iOS devices: wheel/touch scroll, repeated pans with delayed network responses, theme changes, tab switching, and long tables. Capture rendering traces and INP separately; requestAnimationFrame measurements on a headless VPS cannot establish end-user smoothness across the site.

## Primary sources

- TradingView library: https://github.com/tradingview/lightweight-charts
- Rendering pipeline and frame budgets: https://web.dev/articles/rendering-performance
- Passive wheel/touch listeners: https://developer.chrome.com/docs/lighthouse/best-practices/uses-passive-event-listeners
- Offscreen rendering containment: https://web.dev/articles/content-visibility

## Validation

The chart change passed ESLint, TypeScript (`npx tsc --noEmit`), and the production build. The website-wide items above are researched recommendations, not shipped changes. The temporary browser harness and screenshot are under `/tmp/valuation-browser-test/` on this workspace.
