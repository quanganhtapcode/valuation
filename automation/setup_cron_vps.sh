#!/bin/bash
# Installs crontab for VPS. Safe to re-run (strips old entries first).
# Piped through tr -d '\r' to strip Windows CRLF if script was edited on Windows.

CRON_SCREENER="*/5 * * * * cd /var/www/valuation && .venv/bin/python fetch_sqlite/fetch_vci_screener.py --start-page 0 --page-size 50 --no-filter --db fetch_sqlite/vci_screening.sqlite --workers 10 >> fetch_sqlite/cron_screener.log 2>&1 && .venv/bin/python fetch_sqlite/fetch_vci_screener.py --start-page 0 --page-size 50 --db fetch_sqlite/vci_screening.sqlite --workers 10 >> fetch_sqlite/cron_screener.log 2>&1"
CRON_STATS_FINANCIAL="0 * * * * cd /var/www/valuation && .venv/bin/python fetch_sqlite/fetch_vci_stats_financial.py --db fetch_sqlite/vci_stats_financial.sqlite --workers 10 --delay 0.05 >> fetch_sqlite/cron_stats_financial.log 2>&1"
CRON_SHAREHOLDERS="0 13 * * * cd /var/www/valuation && .venv/bin/python fetch_sqlite/fetch_vci_shareholders.py --db fetch_sqlite/vci_shareholders.sqlite --workers 10 --delay 0.05 >> fetch_sqlite/cron_shareholders.log 2>&1"
CRON_NEWS="*/5 * * * * cd /var/www/valuation && .venv/bin/python fetch_sqlite/fetch_vci_news.py --db fetch_sqlite/vci_ai_news.sqlite --pages 5 --page-size 50 --days-back 30 --prune-days 60 --workers 10 --insecure >> fetch_sqlite/cron_vci_ai_news.log 2>&1"
CRON_STANDOUTS="*/15 * * * * cd /var/www/valuation && .venv/bin/python fetch_sqlite/fetch_vci_standouts.py --db fetch_sqlite/vci_ai_standouts.sqlite --group hose --top-pos 5 --top-neg 5 --insecure >> fetch_sqlite/cron_vci_ai_standouts.log 2>&1"
CRON_RATIO_DAILY="30 13 * * * cd /var/www/valuation && .venv/bin/python fetch_sqlite/fetch_vci_ratio_daily.py --workers 10 --delay 0.05 >> fetch_sqlite/cron_ratio_daily.log 2>&1"
CRON_PRICE_HISTORY="30 11 * * * cd /var/www/valuation && .venv/bin/python -m backend.updater.update_price_history >> logs/price_history_update.log 2>&1"
CRON_TELEGRAM="*/30 * * * * /var/www/valuation/scripts/telegram_uptime_report.sh /var/www/valuation/.telegram_uptime.env >> /var/www/valuation/telegram_uptime.log 2>&1"

(crontab -l 2>/dev/null \
  | grep -v -E "fetch_vci_screener\.py|fetch_vci_stats_financial\.py|fetch_vci_shareholders\.py|fetch_vci_news\.py|fetch_vci_standouts\.py|fetch_vci_ratio_daily\.py|update_price_history\.py|telegram_uptime_report\.sh" \
  | tr -d '\r'; \
  printf '%s\n' "$CRON_SCREENER" "$CRON_STATS_FINANCIAL" "$CRON_SHAREHOLDERS" "$CRON_NEWS" "$CRON_STANDOUTS" "$CRON_RATIO_DAILY" "$CRON_PRICE_HISTORY" "$CRON_TELEGRAM" \
) | crontab -

echo "Cron jobs installed successfully."
crontab -l
