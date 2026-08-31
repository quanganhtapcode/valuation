"""Export labelled Vietnamese financial statements from the local VCI SQLite cache."""

from __future__ import annotations

import csv
import argparse
import json
import sqlite3
import time
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATABASE = PROJECT_ROOT / "data" / "sqlite" / "vci_financials.sqlite"
STATS_DATABASE = PROJECT_ROOT / "data" / "sqlite" / "vci_stats_financial.sqlite"
FIELD_CODES = PROJECT_ROOT / "config" / "vci_field_codes.json"
OUTPUT_DIR = PROJECT_ROOT / "exports" / "bao_cao_tai_chinh_2022_2026"
YEAR_RANGE = (2022, 2026)

STATEMENTS = (
    ("balance_sheet", "BALANCE_SHEET", "bang_can_doi_ke_toan"),
    ("income_statement", "INCOME_STATEMENT", "ket_qua_kinh_doanh"),
    ("cash_flow", "CASH_FLOW", "luu_chuyen_tien_te"),
)
EXCLUDED_COLUMNS = {
    "ticker", "period_kind", "year_report", "quarter_report", "length_report",
    "public_date", "create_date", "update_date", "fetched_at",
}
METADATA_COLUMNS = (
    "Mã cổ phiếu", "Tên công ty", "Loại kỳ", "Năm", "Quý", "Ngày công bố",
)
STATS_LABELS = {
    "pe": "P/E", "pb": "P/B", "ps": "P/S", "roe": "ROE", "roa": "ROA",
    "gross_margin": "Biên lợi nhuận gộp",
    "after_tax_margin": "Biên lợi nhuận sau thuế",
    "net_interest_margin": "Biên lãi thuần (NIM)",
    "cir": "Tỷ lệ chi phí trên thu nhập (CIR)", "car": "Hệ số an toàn vốn (CAR)",
    "casa_ratio": "Tỷ lệ CASA", "npl": "Tỷ lệ nợ xấu (NPL)",
    "ldr": "Tỷ lệ cho vay trên huy động (LDR)",
    "loans_growth": "Tăng trưởng cho vay", "deposit_growth": "Tăng trưởng tiền gửi",
    "price_to_cash_flow": "Giá trên dòng tiền", "ev_to_ebitda": "EV/EBITDA",
    "roic": "ROIC", "ebit_margin": "Biên EBIT", "pre_tax_margin": "Biên lợi nhuận trước thuế",
    "current_ratio": "Hệ số thanh toán hiện hành",
    "quick_ratio": "Hệ số thanh toán nhanh", "cash_ratio": "Hệ số tiền mặt",
    "debt_to_equity": "Nợ trên vốn chủ sở hữu", "financial_leverage": "Đòn bẩy tài chính",
    "asset_turnover": "Vòng quay tài sản", "dividend_yield": "Tỷ suất cổ tức",
    "market_cap": "Vốn hóa thị trường", "shares": "Số lượng cổ phiếu",
    "day_sale_outstanding": "Số ngày phải thu (DSO)",
    "days_inventory_outstanding": "Số ngày tồn kho (DIO)",
    "days_payable_outstanding": "Số ngày phải trả (DPO)",
}


def table_fields(connection: sqlite3.Connection, table: str) -> list[str]:
    return [
        row[1] for row in connection.execute(f"PRAGMA table_info({table})")
        if row[1] not in EXCLUDED_COLUMNS
    ]


def export_statement(
    connection: sqlite3.Connection,
    labels: dict[str, str],
    table: str,
    filename: str,
) -> tuple[int, int]:
    fields = table_fields(connection, table)
    missing_labels = [field for field in fields if not labels.get(field)]
    if missing_labels:
        raise ValueError(f"Missing Vietnamese labels in {table}: {', '.join(missing_labels)}")

    output = OUTPUT_DIR / f"{filename}_{YEAR_RANGE[0]}_{YEAR_RANGE[1]}_vi.csv"
    partial = output.with_suffix(".partial")
    headers = list(METADATA_COLUMNS) + [f"{labels[field]} [{field}]" for field in fields]
    sql = (
        "SELECT f.ticker, COALESCE(s.organ_short_name, ''), f.period_kind, "
        "f.year_report, f.quarter_report, COALESCE(f.public_date, ''), "
        + ", ".join(f"f.{field}" for field in fields)
        + f" FROM {table} f LEFT JOIN stocks s ON s.ticker = f.ticker "
        "WHERE f.year_report BETWEEN ? AND ?"
    )

    row_count = 0
    with partial.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(headers)
        for row in connection.execute(sql, YEAR_RANGE):
            writer.writerow(row)
            row_count += 1
            if row_count % 1_000 == 0:
                time.sleep(0.05)
    partial.replace(output)
    return row_count, len(headers)


def export_stats(company_names: dict[str, str]) -> tuple[int, int]:
    connection = sqlite3.connect(f"file:{STATS_DATABASE}?mode=ro", uri=True)
    try:
        fields = [
            row[1] for row in connection.execute("PRAGMA table_info(stats_financial_history)")
            if row[1] in STATS_LABELS
        ]
        output = OUTPUT_DIR / f"chi_so_tai_chinh_{YEAR_RANGE[0]}_{YEAR_RANGE[1]}_vi.csv"
        partial = output.with_suffix(".partial")
        headers = ["Mã cổ phiếu", "Tên công ty", "Năm", "Quý", "Ngày kỳ báo cáo"] + [
            f"{STATS_LABELS[field]} [{field}]" for field in fields
        ]
        sql = (
            "SELECT ticker, year_report, quarter_report, COALESCE(period_date, ''), "
            + ", ".join(fields)
            + " FROM stats_financial_history WHERE year_report BETWEEN ? AND ?"
        )
        row_count = 0
        with partial.open("w", encoding="utf-8-sig", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(headers)
            for row in connection.execute(sql, YEAR_RANGE):
                writer.writerow([row[0], company_names.get(row[0], ""), *row[1:]])
                row_count += 1
                if row_count % 1_000 == 0:
                    time.sleep(0.05)
        partial.replace(output)
        return row_count, len(headers)
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stats-only", action="store_true", help="Export only financial statistics")
    args = parser.parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    field_codes = json.loads(FIELD_CODES.read_text(encoding="utf-8"))
    connection = sqlite3.connect(f"file:{DATABASE}?mode=ro", uri=True)
    try:
        if not args.stats_only:
            for table, section, filename in STATEMENTS:
                labels = {item["field"]: item["titleVi"] for item in field_codes[section]}
                rows, columns = export_statement(connection, labels, table, filename)
                print(f"{table}: {rows:,} rows, {columns:,} columns")
        company_names = dict(connection.execute("SELECT ticker, organ_short_name FROM stocks"))
        rows, columns = export_stats(company_names)
        print(f"stats_financial_history: {rows:,} rows, {columns:,} columns")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
