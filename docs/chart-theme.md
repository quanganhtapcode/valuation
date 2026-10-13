# Chart theme

The frontend keeps each renderer suited to its data:

| Renderer | Views |
| --- | --- |
| Lightweight Charts | Stock candles/volume; homepage index and P/E/P/B overlay |
| Recharts | Macro history, fund NAV and comparisons, bank loan pies |
| Tremor (Recharts underneath) | Valuation history; foreign flow history |
| SVG | VN30 heatmap |
| External TradingView widget | Macro forex table; follows the site's light/dark mode |

Neutral colors live in `frontend-next/src/app/globals.css` as `--chart-*` tokens. `frontend-next/src/lib/chartTheme.ts` supplies the shared series palette, axis ticks, cursor and tooltip styles; its canvas adapter resolves the same CSS tokens for Lightweight Charts. All internal charts use Manrope, 11px axis labels and 12px tooltips, slate surfaces and subdued grids. Positive/negative and loan-risk/heatmap intensity colors preserve their data meanings.

Tremor charts use the shared tooltip component at `frontend-next/src/components/charts/ChartTooltip.tsx`. External widget internals cannot inherit the site's CSS, so only their supported light/dark theme is controlled.
