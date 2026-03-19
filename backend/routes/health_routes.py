"""
/health endpoint — kiểm tra nhanh trạng thái toàn bộ hệ thống.

Checks:
  - vietnam_stocks.db  : tồn tại, số rows, dữ liệu mới nhất
  - fetch_sqlite/       : index_history, screening, news, standouts freshness
  - logs/pipeline.log   : lần chạy cuối + kết quả
  - systemd timer        : lần trigger cuối / tiếp theo (đọc qua subprocess)
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, jsonify, request
from backend.cache_utils import cache_stats, cache_invalidate_namespaces
from backend.telemetry import get_latency_metrics

health_bp = Blueprint("health", __name__)

# ─── Path helpers ─────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parents[2]   # project root


def _resolve_db() -> Path:
    """Tìm vietnam_stocks.db theo logic của backend/db_path.py."""
    from backend.db_path import resolve_stocks_db_path
    return Path(resolve_stocks_db_path())


def _fetch_sqlite_dir() -> Path:
    return BASE_DIR / "fetch_sqlite"


def _logs_dir() -> Path:
    return BASE_DIR / "logs"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _file_age_minutes(path: Path) -> float | None:
    """Trả về số phút kể từ lần sửa cuối; None nếu không tồn tại."""
    try:
        mtime = path.stat().st_mtime
        return round((time.time() - mtime) / 60, 1)
    except OSError:
        return None


def _file_mtime_iso(path: Path) -> str | None:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    except OSError:
        return None


def _sqlite_query(db: Path, sql: str, default=None):
    """Chạy 1 câu SQL, trả về fetchone()[0] hoặc default nếu lỗi."""
    if not db.exists():
        return default
    try:
        with sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=3) as conn:
            row = conn.execute(sql).fetchone()
            return row[0] if row else default
    except Exception:
        return default


def _run(cmd: str) -> str:
    """Chạy shell command, trả về stdout stripped hoặc chuỗi rỗng nếu lỗi."""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip()
    except Exception:
        return ""


def _status(ok: bool) -> str:
    return "ok" if ok else "warn"


def _overall(checks: dict) -> str:
    """ok nếu tất cả ok, warn nếu có warn nhưng không có error, error nếu có error."""
    statuses = [v.get("status") for v in checks.values() if isinstance(v, dict)]
    if "error" in statuses:
        return "error"
    if "warn" in statuses:
        return "warn"
    return "ok"


# ─── Individual checkers ──────────────────────────────────────────────────────

def _check_main_db() -> dict:
    db = _resolve_db()
    age = _file_age_minutes(db)

    if not db.exists():
        return {"status": "error", "path": str(db), "message": "DB file not found"}

    # Try company_overview (db_updater schema) then fall back to the legacy overview view
    overview_count = _sqlite_query(db, "SELECT COUNT(*) FROM company_overview") \
                     or _sqlite_query(db, "SELECT COUNT(*) FROM overview")
    latest_bs_year = _sqlite_query(db, "SELECT MAX(year) FROM balance_sheet WHERE quarter IS NULL")
    latest_bs_quarter = _sqlite_query(db, "SELECT MAX(year||'Q'||quarter) FROM balance_sheet WHERE quarter IS NOT NULL")
    row_overview = overview_count or 0

    # Coi là warn nếu DB chưa được sửa trong 2 ngày (48h)
    st = "ok" if (age is not None and age < 48 * 60) else "warn"
    return {
        "status": st,
        "path": str(db),
        "last_modified": _file_mtime_iso(db),
        "age_minutes": age,
        "overview_rows": row_overview,
        "latest_annual_year": latest_bs_year,
        "latest_quarter": latest_bs_quarter,
    }


def _check_sqlite_file(
    name: str,
    db: Path,
    freshness_minutes: int,
    freshness_sql: str | None = None,
) -> dict:
    """Generic checker cho các SQLite files trong fetch_sqlite/."""
    age = _file_age_minutes(db)

    if not db.exists():
        return {"status": "warn", "message": "file not found"}

    result: dict = {
        "status": "ok" if (age is not None and age < freshness_minutes) else "warn",
        "last_modified": _file_mtime_iso(db),
        "age_minutes": age,
    }

    if freshness_sql:
        val = _sqlite_query(db, freshness_sql)
        result["latest_record"] = val

    if age is not None and age >= freshness_minutes:
        result["message"] = f"stale — last update {age:.0f} min ago (threshold {freshness_minutes} min)"

    return result


def _check_pipeline_log() -> dict:
    log = _logs_dir() / "pipeline.log"
    age = _file_age_minutes(log)

    if not log.exists():
        return {"status": "warn", "message": "pipeline.log not found"}

    # Đọc 15 dòng cuối
    try:
        lines = log.read_text(encoding="utf-8", errors="replace").splitlines()
        tail = "\n".join(lines[-15:]) if lines else ""
    except OSError:
        tail = ""

    last_success = "PIPELINE COMPLETED" in tail
    last_failed = "Stopping pipeline because" in tail or "exit code" in tail.lower()

    if last_success:
        st = "ok"
        msg = "Last run: SUCCESS"
    elif last_failed:
        st = "warn"
        msg = "Last run: FAILED (see tail)"
    else:
        st = "ok"
        msg = "Running or unknown state"

    return {
        "status": st,
        "last_modified": _file_mtime_iso(log),
        "age_minutes": age,
        "last_run_result": msg,
        "tail": tail,
    }


def _check_systemd_timer() -> dict:
    """Dùng systemctl để lấy thông tin timer (chỉ hoạt động trên Linux)."""
    timer_status = _run("systemctl is-active stock-fetch.timer 2>/dev/null")
    if not timer_status:
        # Không phải Linux / không có systemctl
        return {"status": "ok", "message": "systemctl not available (local env)"}

    next_trigger = _run(
        "systemctl list-timers stock-fetch.timer --no-pager 2>/dev/null "
        "| awk 'NR==2{print $1, $2, $3}'"
    )
    last_trigger = _run(
        "systemctl list-timers stock-fetch.timer --no-pager 2>/dev/null "
        "| awk 'NR==2{print $4, $5, $6}'"
    )
    service_result = _run("systemctl show stock-fetch.service --property=Result --value 2>/dev/null")

    st = "ok"
    if timer_status not in ("active", "waiting", ""):
        st = "warn"
    if service_result and service_result not in ("success", ""):
        st = "warn"

    return {
        "status": st,
        "timer": timer_status or "unknown",
        "last_trigger": last_trigger or "unknown",
        "next_trigger": next_trigger or "unknown",
        "last_service_result": service_result or "unknown",
    }


def _check_cron_screener_log() -> dict:
    log = _fetch_sqlite_dir() / "cron_screener.log"
    age = _file_age_minutes(log)
    if not log.exists():
        return {"status": "warn", "message": "cron_screener.log not found"}
    st = "ok" if (age is not None and age < 15) else "warn"
    return {"status": st, "age_minutes": age, "last_modified": _file_mtime_iso(log)}


def _check_cron_news_log() -> dict:
    log = _fetch_sqlite_dir() / "cron_vci_ai_news.log"
    age = _file_age_minutes(log)
    if not log.exists():
        return {"status": "warn", "message": "cron_vci_ai_news.log not found"}
    st = "ok" if (age is not None and age < 15) else "warn"
    return {"status": st, "age_minutes": age, "last_modified": _file_mtime_iso(log)}


# ─── Main route ───────────────────────────────────────────────────────────────

@health_bp.route("/health")
def health() -> tuple:
    fetch_dir = _fetch_sqlite_dir()

    checks = {
        "cache": {
            "status": "ok",
            **cache_stats(),
        },
        "latency": get_latency_metrics(top_n=15),
        "main_db": _check_main_db(),
        "pipeline_log": _check_pipeline_log(),
        "systemd_timer": _check_systemd_timer(),
        "index_history": _check_sqlite_file(
            "index_history",
            fetch_dir / "index_history.sqlite",
            freshness_minutes=30,
            freshness_sql="SELECT MAX(tradingDate) FROM market_index_history WHERE symbol='VNINDEX'",
        ),
        "screening": _check_sqlite_file(
            "screening",
            fetch_dir / "vci_screening.sqlite",
            freshness_minutes=15,
        ),
        "news": _check_sqlite_file(
            "news",
            fetch_dir / "vci_ai_news.sqlite",
            freshness_minutes=15,
            freshness_sql="SELECT MAX(published_at) FROM news",
        ),
        "standouts": _check_sqlite_file(
            "standouts",
            fetch_dir / "vci_ai_standouts.sqlite",
            freshness_minutes=90,
        ),
        "cron_screener": _check_cron_screener_log(),
        "cron_news": _check_cron_news_log(),
    }

    overall = _overall(checks)
    http_code = 200 if overall == "ok" else 207

    payload = {
        "status": overall,
        "timestamp": datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "checks": checks,
    }

    return jsonify(payload), http_code


@health_bp.route("/cache/invalidate", methods=["POST"])
@health_bp.route("/api/cache/invalidate", methods=["POST"])
def invalidate_cache_namespaces() -> tuple:
    """Admin endpoint to invalidate cache namespaces without restarting workers."""
    token_required = (os.getenv("CACHE_ADMIN_TOKEN") or "").strip()
    if not token_required:
        return jsonify({
            "success": False,
            "error": "Cache invalidation token is not configured",
        }), 503

    token_given = (request.headers.get("X-Cache-Admin-Token") or "").strip()
    if token_given != token_required:
        return jsonify({"success": False, "error": "Forbidden"}), 403

    payload = request.get_json(silent=True) or {}
    requested_namespaces = payload.get("namespaces")

    if requested_namespaces is None:
        requested_namespaces = ["stock_routes", "source_priority", "decorator"]
    if not isinstance(requested_namespaces, list):
        return jsonify({"success": False, "error": "'namespaces' must be a list"}), 400

    namespaces = [str(ns).strip() for ns in requested_namespaces if str(ns).strip()]
    if not namespaces:
        return jsonify({"success": False, "error": "No valid namespaces provided"}), 400

    result = cache_invalidate_namespaces(namespaces)
    return jsonify({
        "success": True,
        "namespaces": namespaces,
        "removed": result,
    }), 200

# Also register at /api/health so nginx /v1/valuation/health works
health_bp.add_url_rule("/api/health", endpoint="api_health", view_func=health)
