# Endpoint reliability review — 2026-10-23

Production spot checks before this change: `/api/market/gold` returned 200 in 3.03 s; `/api/market/ai-takeaways` returned 200 in 1.75 s. These are single observations, not load-test percentiles. The AI response had `available=false`, `model=deterministic-fallback`, and five missing-English-summary placeholders. HTTP success alone does not prove translation availability. Provider credentials, quota and refresh-job logs still need production verification if no successful bilingual snapshot exists.

## Changes

- Gold HTTP requests read the persisted snapshot immediately. Expired quotes trigger one background refresh per worker, with the existing nonblocking file lock coordinating processes. Failed refreshes retain quote timestamps, and a 30-second cooldown bounds retries. Cold starts return retryable 503 rather than a successful empty payload. The browser retries missing/stale gold every five seconds until a fresh response arrives.
- AI snapshots remain readable for at most seven days, with a stale flag after six hours or a session change. Stale market summaries keep their original session context. A provider failure retains the most recent successful bilingual news for at most seven days with its original generation timestamp and an explicit stale label. The read path never invokes AI.
- The AI market panel refreshes serially every minute while visible and retains its last response after transient network failures. Both languages use the same data request. The English UI displays original saved-news date/time when stale.
- Stock AI reads use a one-second SQLite busy timeout, close connections on errors, and return a retryable, sanitized error. Obsolete symbol responses cannot replace the active stock's analysis. Browser API calls now have a default 20-second bound while respecting supplied cancellation signals.
- Gold displays an explicit empty/retry state and English product names.

No environment variables, migrations or database artifact changes. Deploy/reload the backend and frontend; deploy the background AI updater code as well. An existing provider failure is not repaired by showing stale data: confirm a subsequent successful refresh supplies actual English summaries.

## Verification

- Python snapshot, AI validation, endpoint contract and performance regression suites.
- Frontend unit tests, ESLint and production Webpack build.
- Background-fetch tests hold the gold source blocked and verify immediate snapshot reads and request deduplication.
- Persistence regression verifies a failed provider refresh cannot overwrite usable bilingual news.
