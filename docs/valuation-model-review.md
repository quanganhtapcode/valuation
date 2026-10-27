# Valuation model and source review

## Calculation changes

- Corporate CFO-based FCFE/FCFF are marked inapplicable for banks, including custom
  model mixes. They return zero with an explicit diagnostic; zero here means an
  unavailable model, not an estimate that the equity is worthless. Bank P/E and
  ROE-based P/B remain available. The same rule applies in scenarios and Excel.
- A missing or non-positive cash-flow base does not create a perpetuity. FCFF
  cannot report a positive going-concern equity value from net cash alone when
  its operating forecast is unavailable. Such businesses require normalized
  forecasts or an asset/liquidation model.
- Missing peer samples do not fall back to the subject company's market multiple,
  which would anchor the result back to today's share price. Supported ROE-based
  fundamental multiples can still be used when their inputs are available.
- Terminal value's share of DCF is returned in the calculation audit details.
  Existing terminal-growth guards and enterprise-to-equity reconciliation remain.
- Public assumptions are checked before database work: finite values, integer
  horizons of 1–20 years, supported model keys, weights of 0–100, tax of 0–100%,
  terminal growth of 0–10%, and high growth above -100%. Bad requests return 400.
  Zero WACC/Ke retains the existing automatic-rate convention. An explicitly empty
  custom allocation stays empty instead of silently restoring sector defaults.

Financial rationale: [Damodaran on financial service firms](https://pages.stern.nyu.edu/~adamodar/pdfiles/papers/finfirm09.pdf)
explains why corporate debt, reinvestment and cash-flow proxies do not carry over
to banks; [terminal-value guidance](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/valquestions/termvalapproaches.htm)
describes stable-growth closure. These references support applicability choices,
not the predictive accuracy of a particular target price.

## Website behavior

Model availability, policy selection and weighted averages use a shared utility.
Automatic policy allocation can reenable a model when its data recovers; explicit
user selections remain intact. Unavailable models cannot be toggled on, including
bank CFO models when a legacy backend response contains positive raw DCF values.

Valuation requests are cancelled when superseded or unmounted. Errors are shown
with a retry action through Analyze. Reset calculates the defaults again. Edited
assumptions require recalculation before Excel export, so displayed assumptions
and exported results do not drift. Changing tickers creates a fresh valuation
state. The tab also receives company metadata for Excel export. Model controls
support keyboard activation.

Builds now enforce TypeScript checks instead of `ignoreBuildErrors`.

## Verified cleanup

Import traversal from Next.js entry points, including dynamic imports and alias
resolution, found these five source components unreachable; repository searches
confirmed no callers before removal:

- `Hero.tsx`, `MarketIntelligence.tsx`, `OverviewGlobeSection.tsx`
- `Sidebar/FFForexRates.tsx`, `Sidebar/Lottery.tsx`

Removed `cobe`, `use-debounce` and their unused dependency entries. `react-dom`
remains required by Next.js even though the application does not import it.
Removed the unconsumed sensitivity client/renderer from the valuation tab; the
public backend sensitivity endpoint remains supported. Runtime databases, cron
entry points and unrelated operational files were retained.

## Verification and limits

In `frontend-next`, run `npm run lint` and `npm run build -- --webpack`. Run
`npx tsc --noEmit` after the build because Next.js replaces generated types.

This is still a simplified valuation toolkit. Flat cash-flow growth does not
replace a forecast tied to reinvestment, segment economics and cyclicality.
Property RNAV/SOTP, regulatory-capital forecasts for banks, and normalized
mid-cycle earnings need additional data and separate models. The changes do not
establish backtested predictive accuracy. Cached screener valuations pick up the
engine changes on the next scheduled batch refresh; interactive valuations use
the updated service immediately after worker reload.

The existing strict i18n audit reports inline locale conditionals elsewhere in
the website; the valuation error/help messages added here use both dictionaries.
