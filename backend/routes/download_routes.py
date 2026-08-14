from flask import Blueprint, after_this_request, jsonify, request, redirect, send_file
import logging
import os
import time
import io
import csv
import json
import sqlite3
import tempfile
import zipfile
from functools import lru_cache
from collections import defaultdict
from functools import wraps
from datetime import datetime
from pathlib import Path
from backend.utils import get_client_ip, validate_stock_symbol
from backend.r2_client import get_r2_client
from backend.extensions import get_provider
from backend.db_path import resolve_vci_financial_statement_db_path

download_bp = Blueprint('download', __name__)
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
FINANCIAL_TABLES = (
    ("income_statement", "income_statement", "income_statement"),
    ("balance_sheet", "balance_sheet", "balance_sheet"),
    ("cash_flow", "cash_flow", "cash_flow"),
    ("note", "note", "note"),
)
FINANCIAL_TABLE_BY_ID = {item[0]: item for item in FINANCIAL_TABLES}
FINANCIAL_META_COLUMNS = {
    "ticker", "period_kind", "year_report", "quarter_report", "length_report",
    "public_date", "create_date", "update_date", "fetched_at",
}
FINANCIAL_METADATA_HEADERS = [
    "Mã cổ phiếu", "Loại kỳ", "Năm", "Quý", "Kỳ tính (tháng)", "Ngày công bố",
]
BANK_SYMBOLS = {
    "VCB", "BID", "CTG", "TCB", "MBB", "ACB", "VPB", "HDB", "SHB", "STB",
    "TPB", "LPB", "MSB", "OCB", "EIB", "ABB", "NAB", "PGB", "VAB", "VIB",
    "SSB", "BAB", "KLB", "BVB", "KBS", "SGB", "NVB",
}
# Vietcap's standard income-statement hierarchy for banks. The order matches the
# Financials tab, while zero-only fields are still excluded per export scope.
BANK_INCOME_FIELDS = (
    "isb27", "isb25", "isb26", "isb30", "isb28", "isb29", "isb31", "isb32",
    "isb33", "isb36", "isb34", "isb35", "isb37", "isb38", "isb39", "isb40",
    "isb41", "isa16", "isa19", "isa17", "isa18", "isa20", "isa21", "isa22",
    "isa23", "isa24",
)
NORMAL_INCOME_FIELDS = (
    "isa1", "isa2", "isa3", "isa4", "isa5", "isa6", "isa7", "isa8",
    "isa102", "isa9", "isa10", "isa11", "isa14", "isa12", "isa13", "isa15",
    "isa16", "isa19", "isa17", "isa18", "isa20", "isa21", "isa22", "isa23",
    "isa24",
)
BANK_BALANCE_FIELDS = (
    "bsa53",
    *(f"bsb{code}" for code in range(97, 111)),
    "bsa43", "bsa44", "bsa45", "bsa46", "bsa47",
    "bsa29", "bsa30", "bsa31", "bsa32", "bsa33", "bsa34", "bsa35",
    "bsa36", "bsa37", "bsa38", "bsa40", "bsa41", "bsa42",
    "bsa49", "bsa50", "bsa51", "bsa52",
    "bsa54",
    *(f"bsb{code}" for code in range(111, 118)),
    "bsa78", *(f"bsb{code}" for code in range(118, 122)),
    "bsa80", "bsa81", "bsa82", "bsa83", "bsa84", "bsa85", "bsa90",
    "bsa210", "bsa96",
)
BANK_CASH_FLOW_FIELDS = (
    *(f"cfb{code}" for code in range(75, 82)), "cfb106",
    "cfa43", "cfa9",
    *(f"cfb{code}" for code in range(48, 65)), "cfa18",
    "cfa19", "cfa20", "cfb67", "cfb68", "cfb69", "cfa23", "cfa24", "cfa25", "cfa26",
    "cfa27", "cfa28", "cfa29", "cfa30", "cfa31", "cfa32", "cfa34", "cfa35", "cfa36", "cfa37", "cfa38",
)


def _quote_identifier(identifier: str) -> str:
    """Quote SQLite identifiers derived from a table schema."""
    return f'"{identifier.replace(chr(34), chr(34) * 2)}"'


def _financial_labels() -> dict[str, str]:
    path = PROJECT_ROOT / "fetch_sqlite" / "vci_field_codes.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    labels: dict[str, str] = {}
    for entries in payload.values():
        for entry in entries:
            field = str(entry.get("field") or "").lower()
            title = str(entry.get("titleEn") or "").strip()
            if field and title and title.upper() != field.upper():
                labels[field] = title
    return labels


@lru_cache(maxsize=1)
def _vietcap_field_order() -> dict[str, list[str]]:
    """Read the same statement-field ordering used by Vietcap's workbooks."""
    path = PROJECT_ROOT / "fetch_sqlite" / "vci_field_codes.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return {
        section: [str(entry.get("field") or "").lower() for entry in entries if entry.get("field")]
        for section, entries in payload.items()
        if isinstance(entries, list)
    }


def _database_financial_labels(connection: sqlite3.Connection) -> dict[str, str]:
    """Use stored mapping labels for fields not covered by the static VCI map."""
    try:
        rows = connection.execute(
            """
            SELECT field, COALESCE(NULLIF(full_title_en, ''), NULLIF(title_en, ''), NULLIF(name, ''))
            FROM statement_metrics
            """
        )
        return {
            str(field).lower(): str(label).strip()
            for field, label in rows
            if field and label and str(label).strip().lower() != str(field).strip().lower()
        }
    except sqlite3.Error:
        return {}


def _selected_market_tickers() -> list[str]:
    catalog_path = PROJECT_ROOT / "frontend-next" / "public" / "ticker_data.json"
    try:
        payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    except Exception:
        return []
    items = payload.get("tickers", []) if isinstance(payload, dict) else []
    scope = (request.args.get("scope") or "ticker").strip().lower()
    exchanges = {item.strip().upper() for item in (request.args.get("exchanges") or "").split(",") if item.strip()}
    sectors = {item.strip() for item in (request.args.get("sectors") or "").split(",") if item.strip()}
    requested = {item.strip().upper() for item in (request.args.get("tickers") or "").split(",") if item.strip()}
    result: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        ticker = str(item.get("symbol") or "").strip().upper()
        if not ticker:
            continue
        if scope == "ticker" and requested and ticker not in requested:
            continue
        if scope in {"market", "industry"} and exchanges and str(item.get("exchange") or "").upper() not in exchanges:
            continue
        if scope == "industry" and sectors and str(item.get("sector") or "") not in sectors:
            continue
        if scope == "ticker" and requested and ticker in requested:
            result.append(ticker)
        elif scope in {"market", "industry"}:
            result.append(ticker)
    return sorted(set(result))


def _period_sql(alias: str = "f") -> tuple[str, list[int | str]]:
    kind = (request.args.get("period_kind") or "year").strip().lower()
    try:
        from_year = int(request.args.get("from_year") or 2020)
        to_year = int(request.args.get("to_year") or datetime.utcnow().year)
    except ValueError:
        raise ValueError("Invalid year range")
    if from_year > to_year:
        raise ValueError("from_year must not be greater than to_year")
    if kind == "quarter":
        from_quarter = int(request.args.get("from_quarter") or 1)
        to_quarter = int(request.args.get("to_quarter") or 4)
        if not 1 <= from_quarter <= 4 or not 1 <= to_quarter <= 4:
            raise ValueError("Quarter must be between 1 and 4")
        return (
            f"{alias}.period_kind = 'QUARTER' AND "
            f"({alias}.year_report * 4 + {alias}.quarter_report) BETWEEN ? AND ?",
            [from_year * 4 + from_quarter, to_year * 4 + to_quarter],
        )
    if kind == "all":
        return f"{alias}.year_report BETWEEN ? AND ?", [from_year, to_year]
    return f"{alias}.period_kind = 'YEAR' AND {alias}.year_report BETWEEN ? AND ?", [from_year, to_year]


def _column_headers(fields: list[str], labels: dict[str, str]) -> list[str]:
    used: set[str] = set()
    headers: list[str] = []
    for field in fields:
        base = labels.get(field.lower(), field)
        header = base if base not in used else f"{base} [{field}]"
        used.add(header)
        headers.append(header)
    return headers


def _is_empty_financial_value(value: object) -> bool:
    """Treat numeric zeroes returned as numbers or text as empty cells."""
    if value is None:
        return True
    if isinstance(value, str):
        normalized = value.strip().replace(",", "")
        if not normalized:
            return True
        try:
            return float(normalized) == 0
        except ValueError:
            return False
    return value == 0


def _visible_financial_fields(
    connection: sqlite3.Connection,
    table: str,
    fields: list[str],
    period_clause: str,
    period_params: list[int | str],
) -> list[str]:
    """Keep only columns that contain at least one non-zero value in this export."""
    if not fields:
        return []
    checks = ", ".join(
        f"MAX(CASE WHEN f.{_quote_identifier(field)} IS NOT NULL "
        f"AND f.{_quote_identifier(field)} != 0 THEN 1 ELSE 0 END)"
        for field in fields
    )
    row = connection.execute(
        f"SELECT {checks} FROM {table} f "
        f"JOIN selected_financial_tickers t ON t.ticker = f.ticker "
        f"WHERE {period_clause}",
        period_params,
    ).fetchone()
    return [field for field, has_value in zip(fields, row or ()) if has_value]


def _all_selected_tickers_are_banks(connection: sqlite3.Connection) -> bool:
    tickers = [row[0] for row in connection.execute("SELECT ticker FROM selected_financial_tickers")]
    return bool(tickers) and all(str(ticker).upper() in BANK_SYMBOLS for ticker in tickers)


def _selected_financial_tickers(connection: sqlite3.Connection) -> list[str]:
    return [str(row[0]).upper() for row in connection.execute(
        "SELECT ticker FROM selected_financial_tickers ORDER BY ticker"
    )]


def _export_fields(connection: sqlite3.Connection, table: str, period_clause: str, period_params: list[int | str]) -> list[str]:
    fields = [
        row[1] for row in connection.execute(f"PRAGMA table_info({table})")
        if row[1] not in FINANCIAL_META_COLUMNS
    ]
    selected_tickers = _selected_financial_tickers(connection)
    if table == "income_statement" and len(selected_tickers) == 1:
        available = set(fields)
        template = BANK_INCOME_FIELDS if _all_selected_tickers_are_banks(connection) else NORMAL_INCOME_FIELDS
        # Match the original Vietcap workbook: show its canonical income rows,
        # including legitimate zeroes such as diluted EPS.
        return [field for field in template if field in available]
    if len(selected_tickers) == 1 and table in {"balance_sheet", "cash_flow"}:
        is_bank = _all_selected_tickers_are_banks(connection)
        if table == "balance_sheet":
            official_order = BANK_BALANCE_FIELDS if is_bank else _vietcap_field_order().get("BALANCE_SHEET", [])
        else:
            official_order = BANK_CASH_FLOW_FIELDS if is_bank else _vietcap_field_order().get("CASH_FLOW", [])
        visible = set(_visible_financial_fields(connection, table, fields, period_clause, period_params))
        return [field for field in official_order if field in visible and field in fields]
    return _visible_financial_fields(connection, table, fields, period_clause, period_params)


def _write_single_ticker_statement_csv(
    connection: sqlite3.Connection,
    table: str,
    fields: list[str],
    labels: dict[str, str],
    period_clause: str,
    period_params: list[int | str],
    output: io.TextIOBase,
) -> int:
    """Write a statement in the row-oriented layout of Vietcap's workbook."""
    ticker = _selected_financial_tickers(connection)[0]
    quoted_fields = ", ".join(f'f.{_quote_identifier(field)}' for field in fields)
    rows = connection.execute(
        f"""
        SELECT f.year_report, f.quarter_report, {quoted_fields}
        FROM {table} f
        WHERE f.ticker = ? AND {period_clause}
        ORDER BY CASE f.period_kind WHEN 'YEAR' THEN 0 ELSE 1 END,
                 f.year_report, f.quarter_report
        """,
        [ticker, *period_params],
    ).fetchall()
    writer = csv.writer(output)
    has_annual = any(not quarter for _, quarter, *_ in rows)
    has_quarterly = any(quarter for _, quarter, *_ in rows)
    period_label = "Năm, Quý" if has_annual and has_quarterly else "Năm" if has_annual else "Quý"
    writer.writerow(["Ngày xuất", datetime.utcnow().strftime("%d/%m/%Y")])
    writer.writerow(["Mã", ticker])
    writer.writerow(["Thời gian", period_label])
    writer.writerow(["Tiền tệ", "VND"])
    writer.writerow([])
    periods = [
        str(year) if not quarter else f"Q{quarter}/{year}"
        for year, quarter, *_ in rows
    ]
    writer.writerow(["Chỉ tiêu", *periods])
    for index, field in enumerate(fields):
        writer.writerow([
            labels.get(field.lower(), field),
            *(row[index + 2] if row[index + 2] is not None else "" for row in rows),
        ])
    return len(fields)


def _write_financial_csv(connection: sqlite3.Connection, table: str, fields: list[str], labels: dict[str, str], period_clause: str, period_params: list[int | str], output: io.TextIOBase) -> int:
    if table in {"income_statement", "balance_sheet", "cash_flow"} and len(_selected_financial_tickers(connection)) == 1:
        return _write_single_ticker_statement_csv(
            connection, table, fields, labels, period_clause, period_params, output,
        )
    writer = csv.writer(output)
    metadata = FINANCIAL_METADATA_HEADERS
    if table == "note":
        writer.writerow(metadata + ["field_code", "field_name_en", "value"])
    else:
        writer.writerow(metadata + _column_headers(fields, labels))
    params = list(period_params)
    sql = (
        f"SELECT f.ticker, f.period_kind, f.year_report, f.quarter_report, f.length_report, "
        f"COALESCE(f.public_date, ''), {', '.join(f'f.{_quote_identifier(field)}' for field in fields)} "
        f"FROM {table} f JOIN selected_financial_tickers t ON t.ticker = f.ticker WHERE {period_clause} "
        "ORDER BY f.ticker, f.year_report, f.quarter_report"
    )
    count = 0
    for row in connection.execute(sql, params):
        metadata_values = list(row[:6])
        values = row[6:]
        if table == "note":
            for field, value in zip(fields, values):
                if _is_empty_financial_value(value):
                    continue
                writer.writerow(metadata_values + [field, labels.get(field.lower(), field), value])
                count += 1
        else:
            if not any(not _is_empty_financial_value(value) for value in values):
                continue
            writer.writerow(metadata_values + list(values))
            count += 1
    return count


def financial_bulk_export():
    """Export selected financial statements without sending thousands of API requests from the browser."""
    temporary_paths: list[str] = []
    try:
        tickers = _selected_market_tickers()
        if not tickers:
            return jsonify({"success": False, "error": "No tickers matched the selected scope"}), 400
        period_clause, period_params = _period_sql()
        labels = _financial_labels()
        db_path = resolve_vci_financial_statement_db_path()
        connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            labels = {**_database_financial_labels(connection), **labels}
            connection.execute("CREATE TEMP TABLE selected_financial_tickers (ticker TEXT PRIMARY KEY)")
            connection.executemany("INSERT INTO selected_financial_tickers(ticker) VALUES (?)", [(ticker,) for ticker in tickers])
            requested_format = (request.args.get("format") or "csv").lower()
            requested_tables = [
                item.strip().lower()
                for item in (request.args.get("tables") or "").split(",")
                if item.strip()
            ]
            selected_tables = tuple(
                FINANCIAL_TABLE_BY_ID[item]
                for item in requested_tables
                if item in FINANCIAL_TABLE_BY_ID
            ) or FINANCIAL_TABLES
            if requested_format == "xlsx":
                from openpyxl import Workbook
                output_path = tempfile.NamedTemporaryFile(prefix="financial-export-", suffix=".xlsx", delete=False).name
                temporary_paths.append(output_path)
                workbook = Workbook(write_only=True)
                for _, table, sheet_name in selected_tables:
                    worksheet = workbook.create_sheet(sheet_name[:31])
                    fields = _export_fields(connection, table, period_clause, period_params)
                    csv_path = tempfile.NamedTemporaryFile(prefix="financial-sheet-", suffix=".csv", delete=False).name
                    temporary_paths.append(csv_path)
                    with open(csv_path, "w", encoding="utf-8", newline="") as handle:
                        _write_financial_csv(connection, table, fields, labels, period_clause, period_params, handle)
                    with open(csv_path, encoding="utf-8", newline="") as handle:
                        for row in csv.reader(handle):
                            worksheet.append(row)
                workbook.save(output_path)
                download_name = "financial-statements.xlsx"
                mimetype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            else:
                output_path = tempfile.NamedTemporaryFile(prefix="financial-export-", suffix=".zip", delete=False).name
                temporary_paths.append(output_path)
                with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                    for _, table, filename in selected_tables:
                        fields = _export_fields(connection, table, period_clause, period_params)
                        csv_path = tempfile.NamedTemporaryFile(prefix="financial-sheet-", suffix=".csv", delete=False).name
                        temporary_paths.append(csv_path)
                        with open(csv_path, "w", encoding="utf-8-sig", newline="") as handle:
                            _write_financial_csv(connection, table, fields, labels, period_clause, period_params, handle)
                        archive.write(csv_path, f"{filename}.csv")
                download_name = "financial-statements.zip"
                mimetype = "application/zip"
        finally:
            connection.close()
        response = send_file(output_path, as_attachment=True, download_name=download_name, mimetype=mimetype)
        @after_this_request
        def cleanup(response):
            for path in temporary_paths:
                try:
                    os.unlink(path)
                except OSError:
                    pass
            return response
        return response
    except ValueError as exc:
        for path in temporary_paths:
            try:
                os.unlink(path)
            except OSError:
                pass
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.exception("Bulk financial export failed")
        for path in temporary_paths:
            try:
                os.unlink(path)
            except OSError:
                pass
        return jsonify({"success": False, "error": str(exc)}), 500

# Download rate limiting - track downloads per IP
download_tracker = defaultdict(list)
DOWNLOAD_LIMIT = 20  # Max downloads per IP per window
DOWNLOAD_WINDOW = 3600  # 1 hour window (in seconds)
PRESIGNED_URL_EXPIRES_SECONDS = int(os.getenv("R2_PRESIGNED_EXPIRES_SECONDS", "900"))

def rate_limit_download(f):
    """Decorator to implement rate limiting for downloads"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Use centralized IP detection
        client_ip = get_client_ip()
        
        current_time = time.time()
        
        # Clean up old download records (outside the time window)
        download_tracker[client_ip] = [
            timestamp for timestamp in download_tracker[client_ip]
            if current_time - timestamp < DOWNLOAD_WINDOW
        ]
        
        # Check if IP has exceeded the limit
        if len(download_tracker[client_ip]) >= DOWNLOAD_LIMIT:
            oldest_download = download_tracker[client_ip][0]
            time_until_reset = DOWNLOAD_WINDOW - (current_time - oldest_download)
            
            logger.warning(f"Rate limit exceeded for IP {client_ip}: {len(download_tracker[client_ip])} downloads in window")
            
            return jsonify({
                'error': 'Rate limit exceeded',
                'message': f'You have exceeded the download limit of {DOWNLOAD_LIMIT} files per hour. Please try again later.',
                'retry_after': int(time_until_reset),
                'retry_after_minutes': round(time_until_reset / 60, 1)
            }), 429  # 429 Too Many Requests
        
        # Record this download
        download_tracker[client_ip].append(current_time)
        
        logger.info(f"Download request from IP {client_ip}: {len(download_tracker[client_ip])}/{DOWNLOAD_LIMIT} in current window")
        
        return f(*args, **kwargs)
    return decorated_function


download_bp.route("/api/financial-bulk-export")(rate_limit_download(financial_bulk_export))


def stock_excel_manifest():
    """Return direct R2 URLs so the browser can download files into a folder."""
    try:
        tickers = _selected_market_tickers()
        if not tickers:
            return jsonify({"success": False, "error": "No tickers matched the selected scope"}), 400
        r2_client = get_r2_client()
        if not r2_client.is_configured:
            return jsonify({"success": False, "error": "R2 is not configured"}), 503

        existing_keys: set[str] = set()
        paginator = r2_client._client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=r2_client.bucket_name, Prefix=f"{r2_client.excel_folder}/"):
            existing_keys.update(str(item.get("Key")) for item in page.get("Contents", []) if item.get("Key"))

        files = []
        missing = []
        for ticker in tickers:
            key = r2_client._get_excel_key(ticker)
            if key not in existing_keys:
                missing.append(ticker)
                continue
            url = r2_client._client.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": r2_client.bucket_name,
                    "Key": key,
                    "ResponseContentDisposition": f'attachment; filename="{ticker}.xlsx"',
                },
                ExpiresIn=PRESIGNED_URL_EXPIRES_SECONDS,
            )
            files.append({"ticker": ticker, "filename": f"{ticker}.xlsx", "url": url})

        if not files:
            return jsonify({"success": False, "error": "No original Vietcap Excel files found in R2"}), 404
        return jsonify({
            "success": True,
            "files": files,
            "count": len(files),
            "missing": missing,
        })
    except Exception as exc:
        logger.exception("Original Excel manifest failed")
        return jsonify({"success": False, "error": str(exc)}), 500


download_bp.route("/api/stock/excel-manifest")(rate_limit_download(stock_excel_manifest))


@download_bp.route("/api/stock/excel-bulk")
@rate_limit_download
def stock_excel_bulk():
    """Bundle original Vietcap Excel files from R2 for a selected market scope."""
    temporary_path: str | None = None
    try:
        tickers = _selected_market_tickers()
        if not tickers:
            return jsonify({"success": False, "error": "No tickers matched the selected scope"}), 400
        r2_client = get_r2_client()
        if not r2_client.is_configured:
            return jsonify({"success": False, "error": "R2 is not configured"}), 503
        temporary_path = tempfile.NamedTemporaryFile(prefix="vietcap-excel-", suffix=".zip", delete=False).name
        found = 0
        with zipfile.ZipFile(temporary_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for ticker in tickers:
                key = r2_client._get_excel_key(ticker)
                try:
                    response = r2_client._client.get_object(Bucket=r2_client.bucket_name, Key=key)
                    with response["Body"] as source, archive.open(f"{ticker}.xlsx", "w") as target:
                        while chunk := source.read(1024 * 1024):
                            target.write(chunk)
                    found += 1
                except Exception:
                    logger.warning("Original Vietcap Excel not found for %s", ticker)
        if not found:
            raise FileNotFoundError("No original Vietcap Excel files found in R2")
        response = send_file(temporary_path, as_attachment=True, download_name="vietcap-excel-original.zip", mimetype="application/zip")
        @after_this_request
        def cleanup(response):
            try:
                os.unlink(temporary_path)
            except OSError:
                pass
            return response
        return response
    except FileNotFoundError as exc:
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except OSError:
                pass
        return jsonify({"success": False, "error": str(exc)}), 404
    except Exception as exc:
        logger.exception("Bulk original Excel export failed")
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except OSError:
                pass
        return jsonify({"success": False, "error": str(exc)}), 500

@download_bp.route("/api/stock/excel/<symbol>")
def api_stock_excel_url(symbol):
    """Returns the download URL for a stock's Excel file (JSON response for frontend)"""
    try:
        # Validate symbol
        is_valid, clean_symbol = validate_stock_symbol(symbol)
        if not is_valid:
            return jsonify({"success": False, "error": "Invalid symbol"}), 400
            
        # 1. Try R2 First for optimized direct download
        r2_client = get_r2_client()
        if r2_client.is_configured:
            # Generate presigned URL
            presigned_result = r2_client.get_presigned_url(
                clean_symbol,
                expires_in=PRESIGNED_URL_EXPIRES_SECONDS,
            )
            
            if presigned_result.get('success'):
                # Return the Cloudflare CDN url directly!
                return jsonify({
                    "success": True,
                    "url": presigned_result['url']
                })
            elif presigned_result.get('not_found'):
                return jsonify({
                    "success": False, 
                    "error": f"Không tìm thấy file dữ liệu Excel cho {clean_symbol}"
                }), 404
        
        # 2. Fallback (If R2 is down or not configured)
        return jsonify({
            "success": True,
            "url": f"/api/download/{clean_symbol}"
        })
    except Exception as exc:
        logger.error(f"API /stock/excel error {symbol}: {exc}")
        return jsonify({"success": False, "error": str(exc)}), 500

@download_bp.route('/api/download/<ticker>')
@rate_limit_download
def download_financial_data(ticker):
    """Download financial statement Excel file for a specific ticker
    
    Storage: Cloudflare R2 (with local fallback)
    Security: Pre-signed URLs with configurable expiration (default 15 minutes)
    
    Rate limits:
    - Maximum 20 downloads per IP per hour
    - Returns 429 status code when limit exceeded
    - CORS restricted to official domains
    """
    try:
        # Use centralized validation
        is_valid, result = validate_stock_symbol(ticker)
        if not is_valid:
            logger.warning(f"Invalid ticker from {get_client_ip()}: {ticker} - {result}")
            return jsonify({
                'error': 'Invalid ticker',
                'message': result
            }), 400
        
        # Use validated/sanitized ticker
        ticker = result
        client_ip = get_client_ip()
        proxy_mode = request.args.get('proxy', '').strip().lower() in {'1', 'true', 'yes'}
        
        # Try R2 first (primary storage)
        r2_client = get_r2_client()
        if r2_client.is_configured:
            if proxy_mode:
                # Same-origin proxy mode for browser fetch/XHR (avoids R2 CORS issues)
                dl = r2_client.download_excel(ticker)
                if dl.get('success') and dl.get('content'):
                    logger.info(f"R2 proxy download for {ticker} to {client_ip}")
                    return send_file(
                        io.BytesIO(dl['content']),
                        as_attachment=True,
                        download_name=f'{ticker}.xlsx',
                        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    )
                if not dl.get('not_found'):
                    logger.warning(f"R2 proxy download failed for {ticker}: {dl.get('error')}")

            # Redirect to pre-signed URL (user downloads directly from R2 CDN)
            # CORS is configured on R2 bucket to allow valuation.quanganh.org
            presigned_result = r2_client.get_presigned_url(
                ticker,
                expires_in=PRESIGNED_URL_EXPIRES_SECONDS,
            )
            
            if presigned_result['success']:
                logger.info(f"R2 redirect for {ticker} to {client_ip}")
                return redirect(presigned_result['url'], code=302)
            elif presigned_result.get('not_found'):
                # File not in R2, try local fallback
                pass
            else:
                # R2 error, log and try local fallback
                logger.warning(f"R2 presigned URL failed for {ticker}: {presigned_result.get('error')}")
        
        # Fallback: Local file system (for backwards compatibility)
        # Note: We assume 'data/' is relative to the project root, which is one level up from 'backend/'
        # but 'backend/routes/' is two levels down.
        # Adjusted path logic:
        # __file__ is in backend/routes/download_routes.py
        # os.path.dirname(__file__) -> backend/routes
        # os.path.dirname(...) -> backend
        # os.path.dirname(...) -> root
        # root/data -> data folder
        script_dir = os.path.dirname(os.path.abspath(__file__))
        data_folder = os.path.join(os.path.dirname(os.path.dirname(script_dir)), 'data')
        file_path = os.path.join(data_folder, f'{ticker}.xlsx')
        
        if os.path.exists(file_path):
            file_size = os.path.getsize(file_path)
            logger.info(f"Local fallback for {ticker} ({file_size} bytes) to {client_ip}")
            return send_file(
                file_path,
                as_attachment=True,
                download_name=f'{ticker}.xlsx',
                mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            )
        
        # File not found in R2 or local
        logger.warning(f"Financial data not found for {ticker} (R2 and local)")
        return jsonify({
            'error': 'File not found',
            'message': f'Financial data for {ticker} is not available. The ticker may not exist or data has not been collected yet.',
            'ticker': ticker
        }), 404
        
    except Exception as e:
        logger.error(f"Error serving file for {ticker}: {e}")
        return jsonify({
            'error': 'Server error',
            'message': f'An error occurred while processing your download: {str(e)}',
            'ticker': ticker
        }), 500

@download_bp.route("/api/stats/downloads")
def get_download_stats():
    """Get download stats (admin only ideally, but public for now)"""
    try:
        # Check simple auth via header if needed, for now open
        stats = {
            "total_active_ips": len(download_tracker),
            "window_seconds": DOWNLOAD_WINDOW,
            "limit": DOWNLOAD_LIMIT,
            "active_ips": []
        }
        
        current_time = time.time()
        
        # Get stats for each IP
        for ip, timestamps in download_tracker.items():
            # Clean up old records
            active_downloads = [ts for ts in timestamps if current_time - ts < DOWNLOAD_WINDOW]
            
            if active_downloads:  # Only show IPs with recent activity
                stats["active_ips"].append({
                    "ip": ip,
                    "downloads_in_window": len(active_downloads),
                    "remaining": max(0, DOWNLOAD_LIMIT - len(active_downloads)),
                    "is_rate_limited": len(active_downloads) >= DOWNLOAD_LIMIT,
                    "last_download": datetime.fromtimestamp(active_downloads[-1]).strftime("%Y-%m-%d %H:%M:%S") if active_downloads else None
                })
        
        # Sort by most active
        stats["active_ips"].sort(key=lambda x: x["downloads_in_window"], reverse=True)
        
        return jsonify({
            "success": True,
            "stats": stats
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500
