# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Vietnamese stock valuation platform. The Next.js 16 frontend lives in `frontend-next/`, with routes in `src/app`, UI in `src/components`, shared API/types/utilities in `src/lib`, and static assets in `public`. Python entry points and data scripts live at the repo root, including `run_pipeline.py` and `update_excel_data.py`. The Flask backend is under `backend/` when available. Documentation is in `docs/`; generated SQLite files such as `price_history.sqlite` are runtime artifacts unless a change explicitly requires updating them.

## Build, Test, and Development Commands

- `pip install -r requirements.txt`: install Python backend and pipeline dependencies.
- `npm run start-backend`: run the Flask backend via `python -m backend.server`.
- `npm run start-frontend`: start the Next.js dev server from `frontend-next/`.
- `cd frontend-next && npm run dev`: run only the frontend locally.
- `cd frontend-next && npm run build`: create a production Next.js build.
- `cd frontend-next && npm run lint`: run ESLint with Next.js and TypeScript rules.
- `python run_pipeline.py`: run the financial data pipeline.

## Coding Style & Naming Conventions

Use TypeScript for frontend code and keep `strict` mode compatibility. Components use `PascalCase` filenames and exports, hooks/helpers use `camelCase`, and imports should prefer the `@/` alias for `frontend-next/src`. Use spaces, not tabs, and preserve the surrounding file’s indentation. Python code should follow PEP 8, use 4-space indentation, type hints where practical, and clear module-level constants for configuration.

## Testing Guidelines

No dedicated automated test runner is currently configured. For frontend changes, run `cd frontend-next && npm run lint` and `npm run build`. For backend or pipeline changes, run the touched script or endpoint path directly, for example `python run_pipeline.py` or a local smoke check against `/api/health`. If adding tests, colocate frontend tests as `*.test.ts` or `*.test.tsx`, and use `tests/test_*.py` for Python.

## Commit & Pull Request Guidelines

Recent history uses short imperative commits with conventional prefixes, for example `fix: send indices snapshot immediately on WS connect`, `feat: translate FinancialsTab`, and `chore(frontend): sync favicon set`. Prefer `fix:`, `feat:`, `chore:`, or scoped variants.

Pull requests should describe the user-visible change, list verification commands run, link related issues, and include screenshots or short recordings for UI changes. Note any database, environment, or deployment implications.

## Security & Configuration Tips

Do not commit secrets from `.env`, `.telegram_uptime.env`, or production config files. Use `frontend-next/.env.example` as the frontend template and document new environment variables in `README.md` or `docs/`.
