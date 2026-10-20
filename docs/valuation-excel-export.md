# Valuation Excel export

The stock valuation tab downloads a formula-based workbook, optionally packaged
with the original financial-statement workbook. `ReportGenerator.createWorkbook`
builds the same model without triggering a browser download.

The presentation follows Data Download: Vietcap blue (`00308C`), Calibri, aligned
numbers and a clear statement hierarchy. Summary links open the supporting sheets.
Yellow cells with blue text are editable inputs; green text marks linked formulas.
Headers and labels remain visible when scrolling, and each sheet has a print area,
landscape A4 settings and page footers.

DCF uses the audited API cash-flow inputs, discount rates and projection horizon.
FCFF converts enterprise value to equity by subtracting net debt per share. P/E
uses the API's selected EPS, which may be a forecast; Graham uses trailing EPS.
Summary normalizes weights over models with positive values and recalculates when
inputs change. Projection years must be changed on the website and exported again.
Forecast Drivers is an illustrative operating schedule; its margin and CapEx ratio
inputs do not drive DCF cash flows.

The terminal-growth guard follows the backend: negative growth is clamped to zero;
growth at or above the discount rate is reduced to `max(0, rate - 1%)`. Invalid
rates, missing shares, zero prices and zero weights return defined results instead
of division errors. Excel is instructed to recalculate the workbook on opening.

Validation, from `frontend-next/`:

```sh
npm run test:valuation-export
npm run lint
npm run build -- --webpack
npx tsc --noEmit
```

Run the TypeScript check after the build, since building replaces `.next/types`.
Regression tests independently evaluate the exported formulas against public FPT
and VCB API snapshots, then change assumptions to verify recalculation. They also
cover 1, 5, 10 and 20 projection years and workbook serialization. Set
`VALUATION_EXPORT_ARTIFACT_DIR` to retain sample workbooks for layout inspection;
historical rows in these test artifacts are synthetic, not investment data.
