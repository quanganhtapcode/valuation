"""
Weekly VietCap Excel updater:
1) Ask bearer token via Telegram.
2) Wait for user reply containing the token.
3) Download financial Excel files from VietCap.
4) Upload Excel files to Cloudflare R2.

Ticker source: frontend-next/public/ticker_data.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from dotenv import dotenv_values, load_dotenv
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Add project root to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.r2_client import get_r2_client

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
BACKUP_DIR = os.path.join(BASE_DIR, "backups")
STATE_FILE = os.path.join(BACKUP_DIR, "excel_update_state.json")
TICKER_FILE = os.path.join(BASE_DIR, "frontend-next", "public", "ticker_data.json")
TELEGRAM_ENV_FILE = os.path.join(BASE_DIR, ".telegram_uptime.env")

load_dotenv(os.path.join(BASE_DIR, ".env"))

# Performance / schedule config
DEFAULT_MAX_WORKERS = max(2, min(4, os.cpu_count() or 2))
MAX_WORKERS = int(os.getenv("EXCEL_MAX_WORKERS", str(DEFAULT_MAX_WORKERS)))
REQUEST_TIMEOUT = int(os.getenv("EXCEL_REQUEST_TIMEOUT", "15"))
MAX_RETRIES = int(os.getenv("EXCEL_MAX_RETRIES", "3"))
KEEP_LOCAL_BACKUP = os.getenv("EXCEL_KEEP_LOCAL_BACKUP", "false").lower() == "true"
UPDATE_INTERVAL_DAYS = int(os.getenv("EXCEL_UPDATE_INTERVAL_DAYS", "7"))
TOKEN_WAIT_MINUTES = int(os.getenv("EXCEL_TOKEN_WAIT_MINUTES", "30"))
TELEGRAM_TOKEN_BUTTON_TEXT = "🔑 Gửi bearer token"

# Thread-safe counters
counter_lock = threading.Lock()
success_count = 0
fail_count = 0
r2_success_count = 0
r2_fail_count = 0
token_expired = False


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def utc_iso(dt: datetime | None = None) -> str:
    return (dt or now_utc()).isoformat()


def parse_utc(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def load_state() -> dict[str, Any]:
    if not os.path.exists(STATE_FILE):
        return {}
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception as exc:
        print(f"⚠️ Cannot read state file {STATE_FILE}: {exc}")
        return {}


def save_state(state: dict[str, Any]) -> None:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def is_due(state: dict[str, Any], force_run: bool) -> bool:
    if force_run:
        return True
    last_success = parse_utc(state.get("last_success_at"))
    if not last_success:
        return True
    return now_utc() >= (last_success + timedelta(days=UPDATE_INTERVAL_DAYS))


def get_telegram_config() -> tuple[str | None, str | None]:
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if bot_token and chat_id:
        return bot_token, chat_id

    if os.path.exists(TELEGRAM_ENV_FILE):
        env_values = dotenv_values(TELEGRAM_ENV_FILE)
        bot_token = bot_token or env_values.get("TELEGRAM_BOT_TOKEN")
        chat_id = chat_id or env_values.get("TELEGRAM_CHAT_ID")

    return bot_token, chat_id


def send_telegram_message(
    bot_token: str,
    chat_id: str,
    message: str,
    reply_markup: dict[str, Any] | None = None,
    reply_to_message_id: int | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"chat_id": chat_id, "text": message}
    if reply_markup is not None:
        payload["reply_markup"] = json.dumps(reply_markup, ensure_ascii=False)
    if reply_to_message_id is not None:
        payload["reply_to_message_id"] = str(reply_to_message_id)
    resp = requests.post(
        f"https://api.telegram.org/bot{bot_token}/sendMessage",
        data=payload,
        timeout=20,
    )
    resp.raise_for_status()
    payload = resp.json()
    if not payload.get("ok"):
        raise RuntimeError(f"Telegram sendMessage failed: {payload}")
    return payload.get("result") or {}


def answer_callback_query(bot_token: str, callback_query_id: str, text: str = "") -> None:
    requests.post(
        f"https://api.telegram.org/bot{bot_token}/answerCallbackQuery",
        data={"callback_query_id": callback_query_id, "text": text},
        timeout=10,
    )


def extract_bearer_token(text: str) -> str | None:
    if not text:
        return None
    stripped = text.strip()
    if not stripped:
        return None
    if stripped.lower() == TELEGRAM_TOKEN_BUTTON_TEXT.lower():
        return None

    # Accept "Bearer <token>", "/token <token>", or raw JWT.
    bearer_match = re.search(r"(?i)\bbearer\s+([A-Za-z0-9\-._~+/=]+)", stripped)
    if bearer_match:
        token = bearer_match.group(1).strip()
        if len(token) >= 80:
            return token

    token_cmd_match = re.search(r"(?i)^/token\s+([A-Za-z0-9\-._~+/=]+)$", stripped)
    if token_cmd_match:
        token = token_cmd_match.group(1).strip()
        if len(token) >= 80:
            return token

    line_token = stripped.replace("\n", " ")
    jwt_match = re.search(r"\b([A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,})\b", line_token)
    if jwt_match:
        return jwt_match.group(1).strip()

    if len(line_token) >= 80 and " " not in line_token:
        return line_token

    return None


def wait_for_token_reply(
    bot_token: str,
    chat_id: str,
    offset: int,
    sent_after_epoch: int,
    wait_minutes: int,
) -> tuple[str | None, int, int | None]:
    deadline = time.time() + wait_minutes * 60
    next_offset = offset
    prompted_for_paste = False

    while time.time() < deadline:
        resp = requests.get(
            f"https://api.telegram.org/bot{bot_token}/getUpdates",
            params={"timeout": 30, "offset": next_offset},
            timeout=35,
        )
        resp.raise_for_status()
        payload = resp.json()
        if not payload.get("ok"):
            raise RuntimeError(f"Telegram getUpdates failed: {payload}")

        updates = payload.get("result", [])
        if not updates:
            continue

        for update in updates:
            update_id = update.get("update_id")
            if isinstance(update_id, int):
                next_offset = max(next_offset, update_id + 1)

            # Handle inline button click (callback_query)
            callback = update.get("callback_query")
            if isinstance(callback, dict) and not prompted_for_paste:
                cb_chat_id = str(((callback.get("message") or {}).get("chat") or {}).get("id", ""))
                cb_data = str(callback.get("data") or "")
                cb_id = str(callback.get("id") or "")
                print(f"[TG] callback_query: chat={cb_chat_id} data={cb_data!r} id={cb_id}")
                if cb_chat_id == str(chat_id) and cb_data == "send_token":
                    try:
                        answer_callback_query(bot_token, cb_id, "✅ Vui lòng dán token vào chat")
                    except Exception as exc:
                        print(f"[TG] answerCallbackQuery failed (non-fatal): {exc}")
                    try:
                        send_telegram_message(
                            bot_token,
                            chat_id,
                            "👇 Dán Bearer token VCI vào đây:",
                            reply_markup={"force_reply": True, "input_field_placeholder": "eyJ0eXAiOiJKV1QiLCJhbGciOi..."},
                        )
                        print("[TG] ForceReply prompt sent OK")
                    except Exception as exc:
                        print(f"[TG] ForceReply send FAILED: {exc}")
                    prompted_for_paste = True
                    continue

            message = update.get("message") or update.get("edited_message")
            if not isinstance(message, dict):
                continue

            msg_chat_id = str((message.get("chat") or {}).get("id", ""))
            if msg_chat_id != str(chat_id):
                continue

            msg_time = int(message.get("date", 0) or 0)
            if msg_time < sent_after_epoch:
                continue

            text = str(message.get("text") or "")
            token = extract_bearer_token(text)
            if token:
                message_id = message.get("message_id")
                token_message_id = message_id if isinstance(message_id, int) else None
                return token, next_offset, token_message_id

    return None, next_offset, None


def obtain_bearer_token(state: dict[str, Any], force_request: bool = False) -> str | None:
    del force_request  # Token flow is always Telegram-first for weekly runs.
    bot_token, chat_id = get_telegram_config()
    if not bot_token or not chat_id:
        env_token = (os.getenv("VCI_BEARER_TOKEN") or "").strip()
        if env_token:
            print("⚠️ Telegram config missing, fallback to VCI_BEARER_TOKEN")
            return env_token
        print("❌ Missing TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID (env or .telegram_uptime.env)")
        return None

    sent_at = int(time.time())
    msg = (
        "🔐 *Weekly Excel Update — VietCap*\n\n"
        "Cần Bearer token để tải Excel tài chính cho ~1730 mã.\n\n"
        "👇 Bấm nút bên dưới rồi dán token vào chat.\n"
        f"⏳ Chờ tối đa {TOKEN_WAIT_MINUTES} phút."
    )
    inline_keyboard = {
        "inline_keyboard": [[{"text": "🔑 Gửi Bearer Token", "callback_data": "send_token"}]],
    }
    send_telegram_message(bot_token, chat_id, msg, reply_markup=inline_keyboard)
    state["last_token_prompt_at"] = utc_iso()
    save_state(state)
    print("✓ Sent Telegram token request")

    start_offset = int(state.get("telegram_update_offset") or 0)
    token, next_offset, token_message_id = wait_for_token_reply(
        bot_token=bot_token,
        chat_id=chat_id,
        offset=start_offset,
        sent_after_epoch=sent_at,
        wait_minutes=TOKEN_WAIT_MINUTES,
    )
    state["telegram_update_offset"] = next_offset
    save_state(state)

    if token:
        send_telegram_message(
            bot_token,
            chat_id,
            "📥 Đã nhận tin nhắn bearer token, đang kiểm tra token...",
            reply_to_message_id=token_message_id,
        )
        state["last_token_received_at"] = utc_iso()
        save_state(state)
        is_valid, detail = validate_bearer_token(token)
        state["last_token_validation_ok"] = is_valid
        state["last_token_validation_detail"] = detail
        save_state(state)

        if is_valid:
            status_message = (
                "✅ Đã nhận bearer token.\n"
                f"✅ Kiểm tra load thử thành công: {detail}\n"
                "🚀 Bắt đầu cập nhật Excel..."
            )
        else:
            status_message = (
                "✅ Đã nhận bearer token.\n"
                f"❌ Kiểm tra load thử thất bại: {detail}\n"
                "⛔ Dừng job. Vui lòng gửi token mới."
            )

        send_telegram_message(
            bot_token,
            chat_id,
            status_message,
            reply_markup={"remove_keyboard": True},
            reply_to_message_id=token_message_id,
        )
        if is_valid:
            print(f"✓ Received bearer token from Telegram reply ({detail})")
            return token
        print(f"❌ Bearer token validation failed ({detail})")
        return None

    send_telegram_message(
        bot_token,
        chat_id,
        (
            f"❌ Hết thời gian chờ ({TOKEN_WAIT_MINUTES} phút), chưa nhận token hợp lệ.\n"
            "Vui lòng chạy lại job để gửi yêu cầu token mới."
        ),
        reply_markup={"remove_keyboard": True},
    )
    print(f"❌ Did not receive bearer token within {TOKEN_WAIT_MINUTES} minutes")
    return None


def create_session(bearer_token: str) -> requests.Session:
    session = requests.Session()
    retry_strategy = Retry(
        total=MAX_RETRIES,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
    )
    adapter = HTTPAdapter(
        max_retries=retry_strategy,
        pool_connections=MAX_WORKERS,
        pool_maxsize=MAX_WORKERS * 2,
    )
    session.mount("https://", adapter)
    session.headers.update(
        {
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9,vi-VN;q=0.8,vi;q=0.7",
            "Authorization": f"Bearer {bearer_token}",
            "Connection": "keep-alive",
            "Origin": "https://trading.vietcap.com.vn",
            "Referer": "https://trading.vietcap.com.vn/",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/142.0.0.0 Safari/537.36"
            ),
        }
    )
    return session


def validate_bearer_token(bearer_token: str) -> tuple[bool, str]:
    """Quick token check against one known symbol before running full job."""
    session = create_session(bearer_token)
    try:
        url = "https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/VCB/financial-statement/export"
        response = session.get(url, params={"language": "1"}, timeout=REQUEST_TIMEOUT)
        if response.status_code == 200 and len(response.content) > 1000:
            return True, f"VCB OK ({len(response.content) / 1024:.1f} KB)"
        return False, f"HTTP {response.status_code}, bytes={len(response.content)}"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"
    finally:
        session.close()


def get_target_tickers() -> list[str]:
    if not os.path.exists(TICKER_FILE):
        print(f"❌ Ticker file not found: {TICKER_FILE}")
        return []

    try:
        with open(TICKER_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        tickers_raw = data.get("tickers", [])
        symbols = set()
        for item in tickers_raw:
            if isinstance(item, dict):
                symbol = str(item.get("symbol") or "").strip().upper()
                if symbol:
                    symbols.add(symbol)
        return sorted(symbols)
    except Exception as exc:
        print(f"❌ Error loading tickers: {exc}")
        return []


def download_ticker_file(
    session: requests.Session,
    ticker: str,
    index: int,
    total: int,
) -> tuple[str, bytes | None]:
    global success_count, fail_count, token_expired
    if token_expired:
        return ticker, None

    url = f"https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/{ticker}/financial-statement/export"
    params = {"language": "1"}

    try:
        response = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
        with counter_lock:
            if response.status_code == 200:
                content = response.content
                size = len(content)
                if size <= 1000:
                    fail_count += 1
                    print(f"[DL {index}/{total}] {ticker} ✗ (File too small)")
                    return ticker, None

                success_count += 1
                print(f"[DL {index}/{total}] {ticker} ✓ ({size / 1024:.1f} KB)")
                return ticker, content
            elif response.status_code == 401:
                fail_count += 1
                token_expired = True
                print(f"[DL {index}/{total}] {ticker} ✗ (401 - TOKEN EXPIRED)")
            elif response.status_code == 404:
                fail_count += 1
                print(f"[DL {index}/{total}] {ticker} ✗ (404 - Not Found)")
            else:
                fail_count += 1
                print(f"[DL {index}/{total}] {ticker} ✗ (Error {response.status_code})")
        return ticker, None
    except requests.exceptions.ConnectionError:
        with counter_lock:
            fail_count += 1
            print(f"[DL {index}/{total}] {ticker} ✗ (Connection Error)")
        return ticker, None
    except requests.exceptions.Timeout:
        with counter_lock:
            fail_count += 1
            print(f"[DL {index}/{total}] {ticker} ✗ (Timeout)")
        return ticker, None
    except Exception as exc:
        with counter_lock:
            fail_count += 1
            print(f"[DL {index}/{total}] {ticker} ✗ ({type(exc).__name__}: {exc})")
        return ticker, None


def upload_ticker_file(
    r2_client: Any,
    ticker: str,
    content: bytes,
    index: int,
    total: int,
) -> None:
    global fail_count, r2_success_count, r2_fail_count
    r2_result = r2_client.upload_excel(ticker, content)

    with counter_lock:
        if r2_result.get("success"):
            r2_success_count += 1
            print(f"[UP {index}/{total}] {ticker} ✓ R2 ({len(content) / 1024:.1f} KB)")
            if KEEP_LOCAL_BACKUP:
                os.makedirs(DATA_DIR, exist_ok=True)
                with open(os.path.join(DATA_DIR, f"{ticker}.xlsx"), "wb") as f:
                    f.write(content)
        else:
            fail_count += 1
            r2_fail_count += 1
            print(f"[UP {index}/{total}] {ticker} ✗ R2 Upload Failed: {r2_result.get('error')}")


def run_update(bearer_token: str, state: dict[str, Any]) -> int:
    global success_count, fail_count, r2_success_count, r2_fail_count, token_expired

    success_count = 0
    fail_count = 0
    r2_success_count = 0
    r2_fail_count = 0
    token_expired = False

    print("=" * 70)
    print("  📊 WEEKLY VIETCAP EXCEL → CLOUDFLARE R2")
    print(f"  ⚡ {MAX_WORKERS} workers | {MAX_RETRIES} retries | interval {UPDATE_INTERVAL_DAYS}d")
    print("=" * 70)

    r2_client = get_r2_client()
    if not r2_client.is_configured:
        print("❌ R2 client not configured! Check .env file.")
        print("   Required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY")
        return 1

    print(f"✓ R2 bucket: {r2_client.bucket_name}")
    print(f"✓ Excel folder: {r2_client.excel_folder}/")

    tickers = get_target_tickers()
    if not tickers:
        print("❌ No tickers found in frontend-next/public/ticker_data.json")
        return 1

    total = len(tickers)
    print(f"✓ Found {total} tickers in ticker_data.json")
    print(f"\nSTARTING DOWNLOAD PHASE ({MAX_WORKERS} workers)...\n")
    start_time = time.time()

    session = create_session(bearer_token)
    downloaded_files: list[tuple[str, bytes]] = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(download_ticker_file, session, ticker, i, total): ticker
            for i, ticker in enumerate(tickers, start=1)
        }
        for future in as_completed(futures):
            ticker, content = future.result()
            if content is not None:
                downloaded_files.append((ticker, content))
            if token_expired:
                print("\n❌ STOPPING: Bearer token expired during run.")
                executor.shutdown(wait=False, cancel_futures=True)
                break

    session.close()
    print(
        f"\n✓ Download phase done: {len(downloaded_files)} success, "
        f"{total - len(downloaded_files)} failed/skipped"
    )

    if downloaded_files:
        print(f"\nSTARTING UPLOAD PHASE ({MAX_WORKERS} workers)...\n")
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            upload_futures = [
                executor.submit(upload_ticker_file, r2_client, ticker, content, i, len(downloaded_files))
                for i, (ticker, content) in enumerate(downloaded_files, start=1)
            ]
            for future in as_completed(upload_futures):
                future.result()

    elapsed = time.time() - start_time

    print("\n" + "=" * 70)
    print(f"COMPLETED in {elapsed:.1f}s ({elapsed/60:.1f} min)")
    print(f"Download OK: {success_count} | Download Failed: {total - success_count}")
    print(f"R2 Upload OK: {r2_success_count} | R2 Upload Failed: {r2_fail_count}")
    if elapsed > 0:
        print(f"Speed: {total/elapsed:.1f} tickers/second")
    print("=" * 70)

    print("\n📋 Verifying R2 bucket...")
    list_result = r2_client.list_excel_files(max_files=10)
    if list_result.get("success"):
        print(f'✓ R2 bucket has {list_result["count"]} files (showing first 10):')
        for item in list_result["files"][:10]:
            print(f'   - {item["symbol"]}.xlsx ({item["size"]/1024:.1f} KB)')
    else:
        print(f'⚠️ Could not list R2 files: {list_result.get("error")}')

    if not token_expired and r2_success_count > 0:
        state["last_success_at"] = utc_iso()
        state["last_success_count"] = r2_success_count
        save_state(state)
        return 0

    return 1


def notify_telegram_progress(
    bot_token: str | None,
    chat_id: str | None,
    message: str,
) -> None:
    if not bot_token or not chat_id:
        return
    send_telegram_message(bot_token, chat_id, message)


def run_update_with_notifications(
    bearer_token: str,
    state: dict[str, Any],
    bot_token: str | None,
    chat_id: str | None,
) -> int:
    notify_telegram_progress(bot_token, chat_id, "🚀 Bắt đầu job cập nhật Excel tuần...")
    rc = run_update(bearer_token=bearer_token, state=state)
    if rc == 0:
        notify_telegram_progress(
            bot_token,
            chat_id,
            (
                "✅ Job cập nhật Excel hoàn tất.\n"
                f"- Download OK: {success_count}\n"
                f"- Upload OK: {r2_success_count}\n"
                f"- Upload Fail: {r2_fail_count}"
            ),
        )
    else:
        notify_telegram_progress(
            bot_token,
            chat_id,
            (
                "❌ Job cập nhật Excel thất bại.\n"
                f"- Download OK: {success_count}\n"
                f"- Upload OK: {r2_success_count}\n"
                f"- Upload Fail: {r2_fail_count}"
            ),
        )
    return rc


def listen_mode() -> int:
    """Run forever: whenever a bearer token is sent to Telegram, trigger the update job."""
    bot_token, chat_id = get_telegram_config()
    if not bot_token or not chat_id:
        print("❌ Missing TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID")
        return 1

    print("👂 Listen mode started — paste a bearer token in Telegram anytime to trigger update.")
    send_telegram_message(
        bot_token,
        chat_id,
        "👂 Excel updater đang chờ lệnh.\nPaste bearer token VCI vào đây bất kỳ lúc nào để bắt đầu cập nhật.",
    )

    offset = 0
    job_running = False

    while True:
        try:
            resp = requests.get(
                f"https://api.telegram.org/bot{bot_token}/getUpdates",
                params={"timeout": 30, "offset": offset},
                timeout=35,
            )
            resp.raise_for_status()
            data = resp.json()
            if not data.get("ok"):
                print(f"[TG] getUpdates error: {data}")
                time.sleep(5)
                continue

            for update in data.get("result", []):
                update_id = update.get("update_id")
                if isinstance(update_id, int):
                    offset = max(offset, update_id + 1)

                message = update.get("message") or update.get("edited_message")
                if not isinstance(message, dict):
                    continue

                msg_chat_id = str((message.get("chat") or {}).get("id", ""))
                if msg_chat_id != str(chat_id):
                    continue

                text = str(message.get("text") or "")
                normalized_text = text.strip().lower()

                # /status command
                if normalized_text == "/status":
                    state = load_state()
                    last_ok = state.get("last_success_at", "chưa có")
                    last_count = state.get("last_success_count", 0)
                    status = "🔄 Đang chạy" if job_running else "💤 Chờ token"
                    send_telegram_message(
                        bot_token, chat_id,
                        f"📊 Trạng thái: {status}\n✅ Lần chạy cuối: {last_ok}\n📁 Files upload: {last_count}",
                    )
                    continue

                if normalized_text in {"/update", "bearer update"}:
                    send_telegram_message(
                        bot_token,
                        chat_id,
                        (
                            "⚠️ Bạn chưa gửi token.\n"
                            "Vui lòng gửi theo mẫu: Bearer <token>\n"
                            "hoặc /token <token> để bắt đầu cập nhật."
                        ),
                    )
                    continue

                token = extract_bearer_token(text)
                if not token:
                    if normalized_text.startswith("bearer "):
                        send_telegram_message(
                            bot_token,
                            chat_id,
                            "⚠️ Bearer token không hợp lệ hoặc quá ngắn. Vui lòng gửi đầy đủ token.",
                        )
                    continue

                if job_running:
                    send_telegram_message(bot_token, chat_id, "⏳ Job đang chạy, vui lòng chờ xong rồi gửi token mới.")
                    continue

                # Got a token — run job in background thread
                print(f"[TG] Token received, starting job...")
                job_running = True
                state = load_state()

                def run_job(tkn: str, st: dict) -> None:
                    global job_running
                    try:
                        print("[JOB] Validating token...", flush=True)
                        is_valid, detail = validate_bearer_token(tkn)
                        print(f"[JOB] Validation result: {is_valid} — {detail}", flush=True)
                        if not is_valid:
                            send_telegram_message(
                                bot_token, chat_id,
                                f"❌ Token không hợp lệ: {detail}\nVui lòng gửi token mới.",
                            )
                            return
                        send_telegram_message(
                            bot_token, chat_id,
                            f"✅ Token hợp lệ ({detail})\n🚀 Bắt đầu cập nhật Excel...",
                        )
                        run_update_with_notifications(
                            bearer_token=tkn,
                            state=st,
                            bot_token=bot_token,
                            chat_id=chat_id,
                        )
                    except Exception as exc:
                        print(f"[JOB] Exception: {exc}", flush=True)
                        try:
                            send_telegram_message(bot_token, chat_id, f"❌ Lỗi job: {exc}")
                        except Exception:
                            pass
                    finally:
                        job_running = False
                        print("[JOB] Done.", flush=True)

                t = threading.Thread(target=run_job, args=(token, state), daemon=True)
                t.start()

        except KeyboardInterrupt:
            print("\n👋 Listen mode stopped.")
            return 0
        except Exception as exc:
            print(f"[TG] Error in listen loop: {exc}")
            time.sleep(10)


def main() -> int:
    parser = argparse.ArgumentParser(description="Weekly VietCap Excel updater")
    parser.add_argument("--force-run", action="store_true", help="Run immediately, ignore 7-day interval")
    parser.add_argument(
        "--force-token-request",
        action="store_true",
        help="Always ask token via Telegram even when VCI_BEARER_TOKEN is set",
    )
    parser.add_argument(
        "--token",
        default="",
        help="Direct bearer token (highest priority; useful for manual runs)",
    )
    parser.add_argument(
        "--listen",
        action="store_true",
        help="Run forever: trigger update whenever a bearer token is sent to Telegram",
    )
    args = parser.parse_args()

    if args.listen:
        return listen_mode()

    state = load_state()
    if not is_due(state, force_run=args.force_run):
        last_success = state.get("last_success_at")
        print(f"⏭️ Skip: last successful run at {last_success}; next run due after {UPDATE_INTERVAL_DAYS} days.")
        return 0

    bearer_token = (args.token or "").strip()
    if not bearer_token:
        bearer_token = obtain_bearer_token(state, force_request=args.force_token_request)
    if not bearer_token:
        return 1

    bot_token, chat_id = get_telegram_config()
    return run_update_with_notifications(
        bearer_token=bearer_token,
        state=state,
        bot_token=bot_token,
        chat_id=chat_id,
    )


if __name__ == "__main__":
    raise SystemExit(main())
