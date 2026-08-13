#!/usr/bin/env bash
# Send concise Telegram progress for the one-off ai-full-refresh systemd job.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JOB_UNIT="${AI_REFRESH_UNIT:-ai-full-refresh.service}"
LOG_FILE="${AI_FULL_REFRESH_LOG_FILE:-$ROOT_DIR/logs/ai_full_refresh.log}"
TELEGRAM_SCRIPT="$ROOT_DIR/scripts/send_telegram_message.sh"
INTERVAL_SECONDS="${AI_FULL_REFRESH_REPORT_INTERVAL_SECONDS:-600}"

send_update() {
    local phase="$1"
    local ai_count rule_count last_line
    ai_count="$(grep -c '\[AI/groq:' "$LOG_FILE" 2>/dev/null || true)"
    rule_count="$(grep -c '\[rule-based' "$LOG_FILE" 2>/dev/null || true)"
    last_line="$(tail -n 1 "$LOG_FILE" 2>/dev/null || true)"
    "$TELEGRAM_SCRIPT" --message "AI full refresh ${phase}
Groq: ${ai_count} | Rule-based: ${rule_count}
Latest: ${last_line}" || true
}

send_update "started"
while systemctl is-active --quiet "$JOB_UNIT"; do
    sleep "$INTERVAL_SECONDS"
    if systemctl is-active --quiet "$JOB_UNIT"; then
        send_update "running"
    fi
done

result="$(systemctl show "$JOB_UNIT" -p Result --value 2>/dev/null || echo unknown)"
send_update "finished (${result})"
