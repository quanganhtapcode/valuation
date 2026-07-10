#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-/var/www/valuation/.telegram_uptime.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing in $ENV_FILE"
  exit 1
fi

HOSTNAME="$(hostname)"
NOW="$(date '+%Y-%m-%d %H:%M:%S %Z')"
UPTIME_HUMAN="$(uptime -p 2>/dev/null || true)"
LOAD_AVG="$(cut -d ' ' -f1-3 /proc/loadavg 2>/dev/null || echo 'n/a')"
MEMORY="$(free -h | awk '/Mem:/ {print $3"/"$2}' 2>/dev/null || echo 'n/a')"
DISK="$(df -h / | awk 'NR==2 {print $3"/"$2" ("$5")"}' 2>/dev/null || echo 'n/a')"
DISK_PCT="$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}' 2>/dev/null || echo 0)"

SERVICE_NAME="valuation"
SERVICE_STATUS="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo 'unknown')"

PROJECT_ROOT="/var/www/valuation"
SCREENING_DB="${PROJECT_ROOT}/fetch_sqlite/vci_screening.sqlite"
SCREENER_LOG="${PROJECT_ROOT}/logs/cron_screener.log"
HEALTH_URL="http://localhost:8000/health"
HEALTH_RAW="$(curl -sS --max-time 8 "$HEALTH_URL" 2>/dev/null || true)"
if [ -n "$HEALTH_RAW" ]; then
  HEALTH_SUMMARY="$(echo "$HEALTH_RAW" | tr -d '\n' | cut -c1-220)"
else
  HEALTH_SUMMARY="unreachable"
fi

SCREENER_ROWS="n/a"
SCREENER_LATEST_UTC="n/a"
SCREENER_LATEST_LOCAL="n/a"
if [ -r "$SCREENING_DB" ]; then
  SCREENER_ROWS="$(sqlite3 "$SCREENING_DB" "SELECT COUNT(*) FROM screening_data;" 2>/dev/null || echo n/a)"
  SCREENER_LATEST_UTC="$(sqlite3 "$SCREENING_DB" "SELECT MAX(fetched_at) FROM screening_data;" 2>/dev/null || echo n/a)"
  if [ "$SCREENER_LATEST_UTC" != "n/a" ] && [ -n "$SCREENER_LATEST_UTC" ]; then
    SCREENER_LATEST_LOCAL="$(TZ=Asia/Ho_Chi_Minh date -d "$SCREENER_LATEST_UTC" "+%Y-%m-%d %H:%M:%S %Z" 2>/dev/null || echo "$SCREENER_LATEST_UTC")"
  fi
fi
SCREENER_LOG_AGE="n/a"
if [ -f "$SCREENER_LOG" ]; then
  SCREENER_LOG_AGE="$(( ($(date +%s) - $(stat -c %Y "$SCREENER_LOG")) / 60 ))m"
fi
SCREENER_STATUS="OK"
if [ "$SCREENER_ROWS" = "n/a" ] || [ "$SCREENER_LATEST_UTC" = "n/a" ]; then
  SCREENER_STATUS="WARN"
fi
DISK_STATUS="OK"
if [ "${DISK_PCT:-0}" -ge 85 ]; then
  DISK_STATUS="WARN"
fi

MSG="📡 *Valuation Uptime Report*%0A"
MSG+="🖥 Host: *${HOSTNAME}*%0A"
MSG+="🕒 Time: ${NOW}%0A"
MSG+="⏱ Uptime: ${UPTIME_HUMAN}%0A"
MSG+="📈 Load(1/5/15): ${LOAD_AVG}%0A"
MSG+="🧠 Memory: ${MEMORY}%0A"
MSG+="💽 Disk /: ${DISK} [${DISK_STATUS}]%0A"
MSG+="🔎 Screener: ${SCREENER_STATUS}, rows=${SCREENER_ROWS}, latest=${SCREENER_LATEST_LOCAL}, log_age=${SCREENER_LOG_AGE}%0A"
MSG+="🧩 Service(${SERVICE_NAME}): *${SERVICE_STATUS}*%0A"
MSG+="🌐 Health: ${HEALTH_SUMMARY}"

curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}" \
  -d "text=${MSG}" \
  -d "parse_mode=Markdown" \
  >/dev/null

echo "Sent uptime report at ${NOW}"
