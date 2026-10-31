# Minimatch compatibility adapter

ESLint 9, its React/import/accessibility plugins, and ExcelJS's archive tooling
still depend on minimatch 3, 5, or 9. GHSA-g3hv-75wg-m249 is fixed in minimatch
11.0.1 and newer, but version 11 no longer exports a callable CommonJS module.

The root npm override replaces these older packages with this adapter. It exposes
the callable export and default-option helpers expected by legacy consumers while
delegating matching, pattern preprocessing, and `Minimatch` to upstream minimatch
11.0.3 or newer. Parsed segments also expose the `_glob` and `Symbol.match` hooks
used by glob 7. The legacy `makeRe()` helper returns a RegExp-like object supporting
`test()` and `String.match()` through the upstream matcher; it does not compile
patterns into regular expressions or support serialized regex sources.

The upstream dependency uses the alias `minimatch-patched` to
avoid applying the override recursively. No vulnerable matching implementation is
vendored and no audit advisory is suppressed.

Remove this adapter and its override once these upstream consumers support patched
minimatch versions directly. Run `npm run test:dependency-compat`, `npm run lint`,
`npm run build`, and `npm audit` when changing it.

Advisory: https://github.com/advisories/GHSA-g3hv-75wg-m249
