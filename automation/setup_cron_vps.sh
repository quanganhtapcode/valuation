#!/bin/bash
# Installs crontab for VPS. Safe to re-run (strips old entries first).
# Piped through tr -d '\r' to strip Windows CRLF if script was edited on Windows.

RCLONE="--rclone-remote onedrive:valuation-backups --keep-remote 5"

# ── High-frequency jobs ───────────────────────────────────────────────────────

CRON_SCREENER="*/7 * * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name screener --db fetch_sqlite/vci_screening.sqlite --retries 2 --retry-sleep 12 --drop-total-pct 0.20 --keep-ratio 0.60 $RCLONE --command \".venv/bin/python fetch_sqlite/fetch_vci_screener.py --start-page 0 --page-size 50 --no-filter --db fetch_sqlite/vci_screening.sqlite --workers 3 --retries 8 --backoff 1.2 && .venv/bin/python fetch_sqlite/fetch_vci_screener.py --start-page 0 --page-size 50 --db fetch_sqlite/vci_screening.sqlite --workers 3 --retries 8 --backoff 1.2\" >> logs/cron_screener.log 2>&1"

CRON_FOREIGN="*/2 9-15 * * 1-5 cd /var/www/valuation && bash automation/vci_safe_run.sh --name foreign --db fetch_sqlite/vci_foreign.sqlite --retries 2 --retry-sleep 12 --drop-total-pct 0.40 --keep-ratio 0.60 $RCLONE --command \".venv/bin/python fetch_sqlite/fetch_vci_foreign.py --db fetch_sqlite/vci_foreign.sqlite\" >> logs/cron_foreign.log 2>&1"

CRON_NEWS="*/10 * * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name market_news --db fetch_sqlite/vci_market_news.sqlite --retries 3 --retry-sleep 20 --drop-total-pct 0.30 --keep-ratio 0.70 $RCLONE --command \".venv/bin/python fetch_sqlite/fetch_vci_market_news.py --db fetch_sqlite/vci_market_news.sqlite --pages 5 --page-size 50 --days-back 30 --prune-days 90 --workers 2 --retries 6 --backoff 1.3 --insecure\" >> logs/cron_vci_market_news.log 2>&1"

# ── Hourly jobs ───────────────────────────────────────────────────────────────

CRON_STATS_FINANCIAL="5 * * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name stats_financial --db fetch_sqlite/vci_stats_financial.sqlite --retries 2 --retry-sleep 15 --drop-total-pct 0.15 --keep-ratio 0.80 $RCLONE --command \".venv/bin/python fetch_sqlite/fetch_vci_stats_financial.py --db fetch_sqlite/vci_stats_financial.sqlite --workers 4 --delay 0.12 --retries 4\" >> logs/cron_stats_financial.log 2>&1"

# ── Daily jobs ────────────────────────────────────────────────────────────────

CRON_PRICE_HISTORY="30 11 * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name price_history --db fetch_sqlite/price_history.sqlite --retries 2 --retry-sleep 20 --drop-total-pct 0.05 --keep-ratio 0.90 $RCLONE --command \".venv/bin/python -m backend.updater.update_price_history\" >> logs/price_history_update.log 2>&1"

CRON_RATIO_DAILY="35 13 * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name ratio_daily --db fetch_sqlite/vci_ratio_daily.sqlite --retries 2 --retry-sleep 15 --drop-total-pct 0.20 --keep-ratio 0.70 $RCLONE --command \".venv/bin/python fetch_sqlite/fetch_vci_ratio_daily.py --db fetch_sqlite/vci_ratio_daily.sqlite --workers 4 --delay 0.12 --retries 4\" >> logs/cron_ratio_daily.log 2>&1"

CRON_SHAREHOLDERS="10 13 * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name shareholders --db fetch_sqlite/vci_shareholders.sqlite --retries 2 --retry-sleep 20 --drop-total-pct 0.30 --keep-ratio 0.70 $RCLONE --command \".venv/bin/python fetch_sqlite/fetch_vci_shareholders.py --db fetch_sqlite/vci_shareholders.sqlite --workers 4 --delay 0.12 --retries 4\" >> logs/cron_shareholders.log 2>&1"

CRON_INDEX_HISTORY="45 15 * * 1-5 cd /var/www/valuation && bash automation/vci_safe_run.sh --name index_history --db fetch_sqlite/vci_index_history.sqlite --retries 2 --retry-sleep 15 --drop-total-pct 0.05 --keep-ratio 0.90 $RCLONE --command \".venv/bin/python fetch_sqlite/fetch_vci.py --indexes VNINDEX,HNXIndex,HNXUpcomIndex,VN30 --start-page 0 --end-page 45 --size 50 --db fetch_sqlite/vci_index_history.sqlite --retries 6 --backoff 0.8\" >> logs/cron_index_history.log 2>&1"

CRON_VALUATION="30 18 * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name valuation --db fetch_sqlite/vci_valuation.sqlite --retries 2 --retry-sleep 20 --drop-total-pct 0.30 --keep-ratio 0.70 $RCLONE --command \".venv/bin/python fetch_sqlite/fetch_vci_valuation.py --db fetch_sqlite/vci_valuation.sqlite\" >> logs/cron_valuation.log 2>&1"

CRON_FINANCIALS="15 18 * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name financials --db fetch_sqlite/vci_financials.sqlite --retries 2 --retry-sleep 20 --drop-total-pct 0.30 --keep-ratio 0.70 $RCLONE --command \".venv/bin/python fetch_sqlite/fetch_vci_financial_statement.py --db-path fetch_sqlite/vci_financials.sqlite --workers 6 --batch-size 40 --max-years 8 --max-quarters 16\" >> logs/cron_financials.log 2>&1"

CRON_NEWS_EVENTS="0 20 * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name news_events --db fetch_sqlite/vci_news_events.sqlite --retries 2 --retry-sleep 30 --drop-total-pct 0.10 --keep-ratio 0.90 $RCLONE --command \".venv/bin/python -m backend.updater.batch_news --incremental\" >> logs/cron_news_events.log 2>&1"

CRON_FIREANT_MACRO="0 7 * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name fireant_macro --db fetch_sqlite/fireant_macro.sqlite --retries 2 --retry-sleep 15 --drop-total-pct 0.05 --keep-ratio 0.90 $RCLONE --command \".venv/bin/python fetch_sqlite/fetch_fireant_macro.py --db fetch_sqlite/fireant_macro.sqlite --workers 3\" >> logs/cron_fireant_macro.log 2>&1"

CRON_MACRO_HISTORY="30 1 * * * cd /var/www/valuation && bash automation/vci_safe_run.sh --name macro_history --db fetch_sqlite/macro_history.sqlite --retries 2 --retry-sleep 15 --drop-total-pct 0.05 --keep-ratio 0.90 $RCLONE --command \".venv/bin/python fetch_sqlite/fetch_macro_history.py --db fetch_sqlite/macro_history.sqlite --workers 4\" >> logs/cron_macro_history.log 2>&1"

# ── Weekly jobs ───────────────────────────────────────────────────────────────

# Sunday 02:00
CRON_COMPANY="0 2 * * 0 cd /var/www/valuation && bash automation/vci_safe_run.sh --name company --db fetch_sqlite/vci_company.sqlite --retries 2 --retry-sleep 20 --drop-total-pct 0.20 --keep-ratio 0.80 $RCLONE --command \".venv/bin/python fetch_sqlite/fetch_vci_company.py --db fetch_sqlite/vci_company.sqlite\" >> logs/cron_vci_company.log 2>&1"

# Sunday 03:00
CRON_FIREANT_BETA="0 3 * * 0 cd /var/www/valuation && bash automation/vci_safe_run.sh --name fireant_beta --db fetch_sqlite/fireant_macro.sqlite --retries 2 --retry-sleep 20 --drop-total-pct 0.30 --keep-ratio 0.70 $RCLONE --command \".venv/bin/python fetch_sqlite/fetch_fireant_beta.py --db fetch_sqlite/fireant_macro.sqlite --workers 8 --delay 0.05\" >> logs/cron_fireant_beta.log 2>&1"

# ── Monitoring ────────────────────────────────────────────────────────────────

CRON_TELEGRAM="*/30 * * * * /var/www/valuation/scripts/telegram_uptime_report.sh /var/www/valuation/.telegram_uptime.env >> /var/www/valuation/logs/telegram_uptime.log 2>&1"

# ── Install ───────────────────────────────────────────────────────────────────

(crontab -l 2>/dev/null \
  | grep -v -E "fetch_vci_screener\.py|fetch_vci_stats_financial\.py|fetch_vci_shareholders\.py|fetch_vci_market_news\.py|fetch_vci_news\.py|fetch_vci_standouts\.py|fetch_vci_ratio_daily\.py|update_price_history(\.py)?|backend\.updater\.update_price_history|backend\.updater\.batch_news|telegram_uptime_report\.sh|fetch_vci_valuation\.py|fetch_vci_foreign\.py|fetch_vci_company\.py|fetch_vci\.py|fetch_fireant_macro\.py|fetch_fireant_beta\.py|fetch_macro_history\.py|automation/vci_safe_run\.sh" \
  | tr -d '\r'; \
  printf '%s\n' \
    "$CRON_SCREENER" \
    "$CRON_FOREIGN" \
    "$CRON_NEWS" \
    "$CRON_STATS_FINANCIAL" \
    "$CRON_PRICE_HISTORY" \
    "$CRON_RATIO_DAILY" \
    "$CRON_SHAREHOLDERS" \
    "$CRON_INDEX_HISTORY" \
    "$CRON_VALUATION" \
    "$CRON_FINANCIALS" \
    "$CRON_NEWS_EVENTS" \
    "$CRON_FIREANT_MACRO" \
    "$CRON_MACRO_HISTORY" \
    "$CRON_COMPANY" \
    "$CRON_FIREANT_BETA" \
    "$CRON_TELEGRAM" \
) | crontab -

echo "Cron jobs installed successfully."
crontab -l
