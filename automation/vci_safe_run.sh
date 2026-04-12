#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  vci_safe_run.sh --name <job-name> --db <db-path> --command "<cmd>" [options]

Options:
  --backup-dir <dir>        Backup directory (default: fetch_sqlite/backups/runtime)
  --retries <n>             Retry whole command on non-zero exit (default: 2)
  --retry-sleep <seconds>   Base retry sleep seconds (default: 10)
  --drop-total-pct <float>  Max allowed total-row drop vs old run (default: 0.25)
  --keep-ratio <float>      Min allowed keep ratio for quality metric vs old run (default: 0.70)
  --notify-telegram <0|1>   Send Telegram summary if script exists (default: 1)
  --notify-script <path>    Telegram sender script (default: scripts/send_telegram_message.sh)
  --keep-local <n>          Number of timestamped backups to keep locally (default: 2)
  --rclone-remote <remote>  rclone remote:path to upload backups before local pruning (e.g. onedrive:valuation-backups)
EOF
}

JOB_NAME=""
DB_PATH=""
RUN_CMD=""
BACKUP_DIR="fetch_sqlite/backups/runtime"
RETRIES=2
RETRY_SLEEP=10
DROP_TOTAL_PCT=0.25
KEEP_RATIO=0.70
NOTIFY_TELEGRAM=1
NOTIFY_SCRIPT="scripts/send_telegram_message.sh"
KEEP_LOCAL=2
RCLONE_REMOTE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) JOB_NAME="${2:-}"; shift 2 ;;
    --db) DB_PATH="${2:-}"; shift 2 ;;
    --command) RUN_CMD="${2:-}"; shift 2 ;;
    --backup-dir) BACKUP_DIR="${2:-}"; shift 2 ;;
    --retries) RETRIES="${2:-}"; shift 2 ;;
    --retry-sleep) RETRY_SLEEP="${2:-}"; shift 2 ;;
    --drop-total-pct) DROP_TOTAL_PCT="${2:-}"; shift 2 ;;
    --keep-ratio) KEEP_RATIO="${2:-}"; shift 2 ;;
    --notify-telegram) NOTIFY_TELEGRAM="${2:-}"; shift 2 ;;
    --notify-script) NOTIFY_SCRIPT="${2:-}"; shift 2 ;;
    --keep-local) KEEP_LOCAL="${2:-}"; shift 2 ;;
    --rclone-remote) RCLONE_REMOTE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[safe-run] Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$JOB_NAME" || -z "$DB_PATH" || -z "$RUN_CMD" ]]; then
  echo "[safe-run] Missing required args" >&2
  usage
  exit 2
fi

mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$DB_PATH")"

db_basename="$(basename "$DB_PATH")"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$BACKUP_DIR/${db_basename}.${ts}.bak"
last_backup="$BACKUP_DIR/${db_basename}.last_good.bak"

sql_scalar() {
  local db="$1"
  local query="$2"
  sqlite3 "$db" "$query" 2>/dev/null || echo ""
}

calc_metrics() {
  local db="$1"
  local base="$2"
  local total=""
  local quality=""

  if [[ ! -f "$db" ]]; then
    echo "0|0"
    return 0
  fi

  case "$base" in
    vci_screening.sqlite)
      total="$(sql_scalar "$db" "SELECT COUNT(*) FROM screening_data;")"
      quality="$(sql_scalar "$db" "SELECT SUM(CASE WHEN (ttmPe IS NOT NULL OR ttmPb IS NOT NULL OR ttmRoe IS NOT NULL OR netMargin IS NOT NULL OR grossMargin IS NOT NULL) THEN 1 ELSE 0 END) FROM screening_data;")"
      ;;
    vci_ratio_daily.sqlite)
      total="$(sql_scalar "$db" "SELECT COUNT(*) FROM ratio_daily;")"
      quality="$(sql_scalar "$db" "SELECT SUM(CASE WHEN (pe IS NOT NULL OR pb IS NOT NULL) THEN 1 ELSE 0 END) FROM ratio_daily;")"
      ;;
    vci_stats_financial.sqlite)
      total="$(sql_scalar "$db" "SELECT COUNT(*) FROM stats_financial;")"
      quality="$(sql_scalar "$db" "SELECT SUM(CASE WHEN (roe IS NOT NULL OR pe IS NOT NULL OR pb IS NOT NULL) THEN 1 ELSE 0 END) FROM stats_financial;")"
      ;;
    vci_ai_news.sqlite)
      total="$(sql_scalar "$db" "SELECT COUNT(*) FROM news_items;")"
      quality="$(sql_scalar "$db" "SELECT SUM(CASE WHEN news_title IS NOT NULL AND TRIM(news_title) <> '' THEN 1 ELSE 0 END) FROM news_items;")"
      ;;
    vci_ai_standouts.sqlite)
      total="$(sql_scalar "$db" "SELECT COUNT(*) FROM standouts_snapshot;")"
      quality="$(sql_scalar "$db" "SELECT SUM(CASE WHEN raw_json IS NOT NULL AND TRIM(raw_json) <> '' THEN 1 ELSE 0 END) FROM standouts_snapshot;")"
      ;;
    vci_foreign.sqlite)
      total="$(sql_scalar "$db" "SELECT COUNT(*) FROM foreign_net_snapshot;")"
      quality="$(sql_scalar "$db" "SELECT SUM(CASE WHEN raw_json IS NOT NULL AND TRIM(raw_json) <> '' THEN 1 ELSE 0 END) FROM foreign_net_snapshot;")"
      ;;
    vci_shareholders.sqlite)
      total="$(sql_scalar "$db" "SELECT COUNT(*) FROM shareholders;")"
      quality="$(sql_scalar "$db" "SELECT SUM(CASE WHEN raw_json IS NOT NULL AND TRIM(raw_json) <> '' THEN 1 ELSE 0 END) FROM shareholders;")"
      ;;
    vci_valuation.sqlite)
      total="$(sql_scalar "$db" "SELECT COUNT(*) FROM valuation_history;")"
      quality="$(sql_scalar "$db" "SELECT SUM(CASE WHEN (pe IS NOT NULL OR pb IS NOT NULL) THEN 1 ELSE 0 END) FROM valuation_history;")"
      ;;
    vci_company.sqlite)
      total="$(sql_scalar "$db" "SELECT COUNT(*) FROM companies;")"
      quality="$(sql_scalar "$db" "SELECT SUM(CASE WHEN (icb_code4 IS NOT NULL AND TRIM(icb_code4) <> '' AND logo_url IS NOT NULL AND TRIM(logo_url) <> '') THEN 1 ELSE 0 END) FROM companies;")"
      ;;
    *)
      total="$(sql_scalar "$db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';")"
      quality="$total"
      ;;
  esac

  total="${total:-0}"
  quality="${quality:-0}"
  echo "${total}|${quality}"
}

prune_backups() {
  # Find all timestamped backups for this DB (excludes last_good.bak)
  local pattern="${BACKUP_DIR}/${db_basename}.20*.bak"
  # shellcheck disable=SC2207
  local files=( $(ls -t ${pattern} 2>/dev/null) )
  local count=${#files[@]}

  if [[ $count -le $KEEP_LOCAL ]]; then
    echo "[safe-run][$JOB_NAME] prune: $count backup(s) found, keeping all (keep-local=$KEEP_LOCAL)"
    return 0
  fi

  local to_delete=( "${files[@]:$KEEP_LOCAL}" )
  echo "[safe-run][$JOB_NAME] prune: $count backups, keeping $KEEP_LOCAL, removing $((count - KEEP_LOCAL))"

  for f in "${to_delete[@]}"; do
    if [[ -n "$RCLONE_REMOTE" ]] && command -v rclone &>/dev/null; then
      local remote_path="${RCLONE_REMOTE}/$(basename "$f")"
      if rclone copyto "$f" "$remote_path" --no-check-dest 2>/dev/null; then
        echo "[safe-run][$JOB_NAME] prune: uploaded $(basename "$f") -> $remote_path"
      else
        echo "[safe-run][$JOB_NAME] prune: warning: rclone upload failed for $(basename "$f"), skipping delete"
        continue
      fi
    fi
    rm -f "$f"
    echo "[safe-run][$JOB_NAME] prune: deleted $(basename "$f")"
  done
}

send_telegram_summary() {
  local status="$1"
  local note="$2"
  if [[ "$NOTIFY_TELEGRAM" != "1" ]]; then
    return 0
  fi
  if [[ ! -x "$NOTIFY_SCRIPT" ]]; then
    return 0
  fi

  local host now msg
  host="$(hostname)"
  now="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  msg="VCI ${JOB_NAME} [${status}]
Host: ${host}
Time: ${now}
DB: ${DB_PATH}
Before: total=${before_total}, quality=${before_quality}
After: total=${after_total}, quality=${after_quality}
Attempts: ${attempt}/${max_attempts}
Result: ${note}"

  if ! "$NOTIFY_SCRIPT" --message "$msg" >/dev/null 2>&1; then
    echo "[safe-run][$JOB_NAME] warning: telegram notify failed"
  fi
}

echo "[safe-run][$JOB_NAME] start ts=$ts db=$DB_PATH"
before_total=0
before_quality=0
after_total=0
after_quality=0
if [[ -f "$DB_PATH" ]]; then
  cp -f "$DB_PATH" "$backup_file"
  cp -f "$DB_PATH" "$last_backup"
  IFS='|' read -r before_total before_quality <<< "$(calc_metrics "$DB_PATH" "$db_basename")"
  echo "[safe-run][$JOB_NAME] before total=$before_total quality=$before_quality backup=$backup_file"
else
  echo "[safe-run][$JOB_NAME] db file not found before run, proceeding"
fi

attempt=1
max_attempts=$((RETRIES + 1))
run_ok=0
while [[ $attempt -le $max_attempts ]]; do
  echo "[safe-run][$JOB_NAME] attempt=$attempt/$max_attempts"
  if bash -lc "$RUN_CMD"; then
    run_ok=1
    break
  fi
  if [[ $attempt -lt $max_attempts ]]; then
    sleep_s=$((RETRY_SLEEP * attempt))
    echo "[safe-run][$JOB_NAME] attempt=$attempt failed, sleeping ${sleep_s}s before retry"
    sleep "$sleep_s"
  fi
  attempt=$((attempt + 1))
done

if [[ $run_ok -ne 1 ]]; then
  echo "[safe-run][$JOB_NAME] all attempts failed"
  if [[ -f "$last_backup" ]]; then
    cp -f "$last_backup" "$DB_PATH"
    echo "[safe-run][$JOB_NAME] rollback applied from $last_backup"
  fi
  prune_backups
  send_telegram_summary "FAILED" "job failed after retries; rollback attempted"
  exit 1
fi

IFS='|' read -r after_total after_quality <<< "$(calc_metrics "$DB_PATH" "$db_basename")"
after_total="${after_total:-0}"
after_quality="${after_quality:-0}"
echo "[safe-run][$JOB_NAME] after total=$after_total quality=$after_quality"

should_rollback=0
if [[ "$before_total" =~ ^[0-9]+$ ]] && [[ "$after_total" =~ ^[0-9]+$ ]] && [[ "$before_total" -gt 0 ]]; then
  if ! awk -v old="$before_total" -v now="$after_total" -v drop="$DROP_TOTAL_PCT" 'BEGIN {min_ok = old * (1.0 - drop); exit(now + 0.0 >= min_ok ? 0 : 1)}'; then
    echo "[safe-run][$JOB_NAME] total dropped too much: old=$before_total now=$after_total drop_limit=$DROP_TOTAL_PCT"
    should_rollback=1
  fi
fi

if [[ "$before_quality" =~ ^[0-9]+$ ]] && [[ "$after_quality" =~ ^[0-9]+$ ]] && [[ "$before_quality" -gt 0 ]]; then
  if ! awk -v old="$before_quality" -v now="$after_quality" -v keep="$KEEP_RATIO" 'BEGIN {min_ok = old * keep; exit(now + 0.0 >= min_ok ? 0 : 1)}'; then
    echo "[safe-run][$JOB_NAME] quality dropped too much: old=$before_quality now=$after_quality keep_ratio=$KEEP_RATIO"
    should_rollback=1
  fi
fi

if [[ $should_rollback -eq 1 ]]; then
  if [[ -f "$last_backup" ]]; then
    cp -f "$last_backup" "$DB_PATH"
    echo "[safe-run][$JOB_NAME] rollback applied due to health check"
  else
    echo "[safe-run][$JOB_NAME] rollback requested but no last backup found"
  fi
  prune_backups
  send_telegram_summary "ROLLED_BACK" "health threshold violated; restored last good backup"
  exit 3
fi

echo "[safe-run][$JOB_NAME] health check passed"
prune_backups
send_telegram_summary "OK" "update completed and health check passed"
exit 0
