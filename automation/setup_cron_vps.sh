#!/bin/bash
# Installs crontab for VPS. Safe to re-run (strips old entries first).
# Piped through tr -d '\r' to strip Windows CRLF if script was edited on Windows.

set -euo pipefail

DRY_RUN=0
case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  "") ;;
  *) echo "Usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

# Remote uploads are opt-in; high-frequency jobs should not transfer a full
# SQLite backup every few minutes. Keep the deployed VPS CPU/schedule budget.
RCLONE="--keep-remote 30"
if [[ -n "${VCI_BACKUP_REMOTE:-}" ]]; then
  printf -v remote_arg '%q' "$VCI_BACKUP_REMOTE"
  RCLONE="$RCLONE --rclone-remote $remote_arg"
fi

# ── High-frequency jobs ───────────────────────────────────────────────────────

CRON_SCREENER="*/30 9-15 * * 1-5 cd /var/www/valuation && bash automation/vci_safe_run.sh --name screener --db data/sqlite/vci_screening.sqlite --retries 2 --retry-sleep 12 --drop-total-pct 0.20 --keep-ratio 0.60 $RCLONE --command \".venv/bin/python scripts/fetchers/fetch_vci_screener.py --start-page 0 --page-size 50 --no-filter --db data/sqlite/vci_screening.sqlite --workers 1 --sleep 1 --retries 4 --backoff 1.2 && .venv/bin/python scripts/fetchers/fetch_vci_screener.py --start-page 0 --page-size 50 --db data/sqlite/vci_screening.sqlite --workers 1 --sleep 1 --retries 4 --backoff 1.2\" >> logs/cron_screener.log 2>&1"

CRON_FOREIGN="*/30 9-15 * * 1-5 cd /var/www/valuation && bash automation/vci_safe_run.sh --name foreign --db data/sqlite/vci_foreign.sqlite --retries 2 --retry-sleep 12 --drop-total-pct 0.40 --keep-ratio 0.60 $RCLONE --command \".venv/bin/python scripts/fetchers/fetch_vci_foreign.py --db data/sqlite/vci_foreign.sqlite\" >> logs/cron_foreign.log 2>&1"

CRON_NEWS="10 7,10,13,16,19,22 * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name market_news --db data/sqlite/vci_market_news.sqlite --retries 1 --retry-sleep 20 --drop-total-pct 0.30 --keep-ratio 0.70 $RCLONE --command \".venv/bin/python scripts/fetchers/fetch_vci_market_news.py --db data/sqlite/vci_market_news.sqlite --pages 5 --page-size 50 --days-back 30 --prune-days 90 --workers 1 --retries 3 --backoff 1.3 --insecure\" >> logs/cron_vci_market_news.log 2>&1"

# ── End-of-day jobs ───────────────────────────────────────────────────────────────

CRON_STATS_FINANCIAL="5 16 * * 1-5 cd /var/www/valuation && bash automation/vci_safe_run.sh --name stats_financial --db data/sqlite/vci_stats_financial.sqlite --retries 2 --retry-sleep 15 --drop-total-pct 0.15 --keep-ratio 0.80 $RCLONE --command \".venv/bin/python scripts/fetchers/fetch_vci_stats_financial.py --incremental --db data/sqlite/vci_stats_financial.sqlite --workers 1 --delay 1 --retries 2\" >> logs/cron_stats_financial.log 2>&1"

# ── Daily jobs ────────────────────────────────────────────────────────────────

CRON_PRICE_HISTORY="30 16 * * 1-5 cd /var/www/valuation && bash automation/vci_safe_run.sh --name price_history --db data/sqlite/vci_price_history.sqlite --retries 2 --retry-sleep 20 --drop-total-pct 0.05 --keep-ratio 0.90 $RCLONE --command \".venv/bin/python -m backend.updater.update_price_history\" >> logs/price_history_update.log 2>&1"

CRON_RATIO_DAILY="35 16 * * 1-5 cd /var/www/valuation && bash automation/vci_safe_run.sh --name ratio_daily --db data/sqlite/vci_ratio_daily.sqlite --retries 2 --retry-sleep 15 --drop-total-pct 0.20 --keep-ratio 0.70 $RCLONE --command \".venv/bin/python scripts/fetchers/fetch_vci_ratio_daily.py --db data/sqlite/vci_ratio_daily.sqlite --workers 1 --delay 1 --retries 2\" >> logs/cron_ratio_daily.log 2>&1"

CRON_SHAREHOLDERS="10 13 * * 0 cd /var/www/valuation && bash automation/vci_safe_run.sh --name shareholders --db data/sqlite/vci_shareholders.sqlite --retries 2 --retry-sleep 20 --drop-total-pct 0.30 --keep-ratio 0.70 $RCLONE --command \".venv/bin/python scripts/fetchers/fetch_vci_shareholders.py --db data/sqlite/vci_shareholders.sqlite --workers 1 --delay 1 --retries 2\" >> logs/cron_shareholders.log 2>&1"

CRON_INDEX_HISTORY="45 15 * * 1-5 cd /var/www/valuation && bash automation/vci_safe_run.sh --name index_history --db data/sqlite/vci_index_history.sqlite --retries 2 --retry-sleep 15 --drop-total-pct 0.05 --keep-ratio 0.90 $RCLONE --command \".venv/bin/python scripts/fetchers/fetch_vci_index_history.py --incremental --indexes VNINDEX,HNXIndex,HNXUpcomIndex,VN30 --start-page 0 --end-page 45 --size 50 --db data/sqlite/vci_index_history.sqlite --retries 3 --backoff 0.8\" >> logs/cron_index_history.log 2>&1"

CRON_VALUATION="30 18 * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name valuation --db data/sqlite/vci_valuation.sqlite --retries 2 --retry-sleep 20 --drop-total-pct 0.30 --keep-ratio 0.70 $RCLONE --command \".venv/bin/python scripts/fetchers/fetch_vci_valuation.py --db data/sqlite/vci_valuation.sqlite\" >> logs/cron_valuation.log 2>&1"

CRON_FINANCIALS="15 18 * * 0 cd /var/www/valuation && bash automation/vci_safe_run.sh --name financials --db data/sqlite/vci_financials.sqlite --retries 2 --retry-sleep 20 --drop-total-pct 0.30 --keep-ratio 0.70 $RCLONE --command \".venv/bin/python scripts/fetchers/fetch_vci_financial_statement.py --db-path data/sqlite/vci_financials.sqlite --workers 1 --batch-size 40 --max-years 0 --max-quarters 0 --resume-missing --resume-since-hours 144\" >> logs/cron_financials.log 2>&1"

# Continue incomplete weekly financial refreshes on subsequent nights.
CRON_FINANCIALS_CATCHUP="${CRON_FINANCIALS/15 18 \* \* 0 /15 1 * * 1-6 }"

CRON_NEWS_EVENTS="0 20,23 * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name news_events --db data/sqlite/vci_news_events.sqlite --retries 2 --retry-sleep 30 --drop-total-pct 0.10 --keep-ratio 0.90 $RCLONE --command \".venv/bin/python -m backend.updater.batch_news --incremental --workers 2 --retries 1 --max-runtime 1800\" >> logs/cron_news_events.log 2>&1"

CRON_FIREANT_MACRO="0 7 * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name fireant_macro --db data/sqlite/fireant_macro.sqlite --retries 2 --retry-sleep 15 --drop-total-pct 0.05 --keep-ratio 0.90 $RCLONE --command \".venv/bin/python scripts/fetchers/fetch_fireant_macro.py --db data/sqlite/fireant_macro.sqlite --workers 1\" >> logs/cron_fireant_macro.log 2>&1"

CRON_MACRO_HISTORY="30 1 * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name macro_history --db data/sqlite/macro_history.sqlite --retries 2 --retry-sleep 15 --drop-total-pct 0.05 --keep-ratio 0.90 $RCLONE --command \".venv/bin/python scripts/fetchers/fetch_macro_history.py --db data/sqlite/macro_history.sqlite --workers 1\" >> logs/cron_macro_history.log 2>&1"

# Vietnam economic observations, separate from the Yahoo history job.
CRON_VIETNAM_MACRO="0 8 * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name vietnam_macro --db data/sqlite/macro_history.sqlite --retries 2 --retry-sleep 20 --drop-total-pct 0.05 --keep-ratio 0.90 $RCLONE --command \".venv/bin/python scripts/fetchers/fetch_vietnam_macro.py --db data/sqlite/macro_history.sqlite\" >> logs/cron_vietnam_macro.log 2>&1"

# ── Weekly jobs ───────────────────────────────────────────────────────────────

# Sunday 02:00. Refresh metadata, regenerate the frontend ticker catalogue, and
# publish the generated catalogue to GitHub so Vercel deploys the update.
CRON_COMPANY="0 2 * * 0 cd /var/www/valuation && bash automation/vci_safe_run.sh --name company --db data/sqlite/vci_company.sqlite --retries 2 --retry-sleep 20 --drop-total-pct 0.20 --keep-ratio 0.80 $RCLONE --command \".venv/bin/python scripts/fetchers/fetch_vci_company.py --db data/sqlite/vci_company.sqlite && .venv/bin/python scripts/generate_ticker_data.py && bash automation/publish_ticker_catalog.sh\" >> logs/cron_vci_company.log 2>&1"

# Sunday 03:00
CRON_FIREANT_BETA="0 3 * * 0 cd /var/www/valuation && bash automation/vci_safe_run.sh --name fireant_beta --db data/sqlite/fireant_macro.sqlite --retries 2 --retry-sleep 20 --drop-total-pct 0.30 --keep-ratio 0.70 $RCLONE --command \".venv/bin/python scripts/fetchers/fetch_fireant_beta.py --db data/sqlite/fireant_macro.sqlite --workers 1 --delay 1\" >> logs/cron_fireant_beta.log 2>&1"

# ── Monitoring ────────────────────────────────────────────────────────────────

CRON_TELEGRAM="*/30 * * * * /var/www/valuation/scripts/telegram_uptime_report.sh /var/www/valuation/.telegram_uptime.env >> /var/www/valuation/logs/telegram_uptime.log 2>&1"

# ── Install ───────────────────────────────────────────────────────────────────

render_crontab() {
  # Preserve unrelated jobs, remove all previous forms of managed fetchers.
  { crontab -l 2>/dev/null || true; } \
    | grep -v -E "fetch_vci_screener\.py|fetch_vci_stats_financial\.py|fetch_vci_shareholders\.py|fetch_vci_market_news\.py|fetch_vci_news\.py|fetch_vci_standouts\.py|fetch_vci_ratio_daily\.py|update_price_history(\.py)?|backend\.updater\.update_price_history|backend\.updater\.batch_news|telegram_uptime_report\.sh|fetch_vci_valuation\.py|fetch_vci_foreign\.py|fetch_vci_company\.py|fetch_vci_financial_statement\.py|fetch_vci\.py|fetch_vci_index_history\.py|fetch_fireant_macro\.py|fetch_fireant_beta\.py|fetch_macro_history\.py|fetch_vietnam_macro\.py|automation/vci_safe_run\.sh" \
    | tr -d '\r' || true

  local line minute hour day month weekday command
  for line in \
    "$CRON_SCREENER" "$CRON_FOREIGN" "$CRON_NEWS" "$CRON_STATS_FINANCIAL" \
    "$CRON_PRICE_HISTORY" "$CRON_RATIO_DAILY" "$CRON_SHAREHOLDERS" \
    "$CRON_INDEX_HISTORY" "$CRON_VALUATION" "$CRON_FINANCIALS" "$CRON_FINANCIALS_CATCHUP" \
    "$CRON_NEWS_EVENTS" "$CRON_FIREANT_MACRO" "$CRON_MACRO_HISTORY" "$CRON_VIETNAM_MACRO" \
    "$CRON_COMPANY" "$CRON_FIREANT_BETA" "$CRON_TELEGRAM"; do
    read -r minute hour day month weekday command <<< "$line"
    printf '%s %s %s %s %s systemd-run --scope --quiet --collect --slice=valuation.slice /bin/bash -lc %q\n' \
      "$minute" "$hour" "$day" "$month" "$weekday" "$command"
  done
}

if [[ $DRY_RUN -eq 1 ]]; then
  render_crontab
else
  mkdir -p /var/www/valuation/logs
  # Render completely before installation; do not replace a live crontab via
  # a pipeline that can install incomplete output if rendering fails.
  cron_file="$(mktemp)"
  trap 'rm -f "$cron_file"' EXIT
  render_crontab > "$cron_file"
  crontab "$cron_file"
  echo "Cron jobs installed successfully."
  crontab -l
fi
