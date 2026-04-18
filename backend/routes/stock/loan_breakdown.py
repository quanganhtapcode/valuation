from __future__ import annotations

import logging
import os
import sqlite3

from flask import Blueprint, jsonify, request

from backend.db_path import resolve_vci_financial_statement_db_path
from backend.utils import validate_stock_symbol

logger = logging.getLogger(__name__)

INDUSTRY_FIELDS: dict[str, str] = {
    "nob12": "Thương mại",
    "nob13": "Nông lâm nghiệp",
    "nob14": "Sản xuất",
    "nob15": "Chế biến, chế tạo",
    "nob16": "Điện, khí đốt",
    "nob17": "Cấp nước, xử lý rác",
    "nob18": "Khai khoáng",
    "nob19": "Xây dựng",
    "nob20": "Dịch vụ cá nhân",
    "nob23": "Y tế",
    "nob24": "Giải trí",
    "nob28": "Dịch vụ khác",
    "nob29": "Vận tải, kho bãi",
    "nob31": "Thông tin, TT",
    "nob32": "Giáo dục",
    "nob34": "Khoa học, CN",
    "nob35": "Bất động sản",
    "nob36": "Khách sạn, nhà hàng",
    "nob37": "Tài chính",
    "nob38": "Ngành khác",
}

NPL_FIELDS: dict[str, str] = {
    "nob40": "Nhóm 1 - Đủ tiêu chuẩn",
    "nob41": "Nhóm 2 - Cần chú ý",
    "nob42": "Nhóm 3 - Dưới tiêu chuẩn",
    "nob43": "Nhóm 4 - Nghi ngờ",
    "nob44": "Nhóm 5 - Có khả năng mất vốn",
}

_TOP_N_INDUSTRY = 7


def _to_int(v) -> int:
    try:
        f = float(v or 0)
        return int(f) if f == f else 0  # nan guard
    except (TypeError, ValueError):
        return 0


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/stock/<symbol>/loan-breakdown")
    def api_loan_breakdown(symbol: str):
        is_valid, clean_symbol = validate_stock_symbol(symbol)
        if not is_valid:
            return jsonify({"error": clean_symbol}), 400

        db_path = resolve_vci_financial_statement_db_path()
        if not db_path or not os.path.exists(db_path):
            return jsonify({"error": "Financial DB not available"}), 503

        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row

            # Check wide-format note table exists
            has_note = bool(conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='note'"
            ).fetchone())
            if not has_note:
                conn.close()
                return jsonify({"error": "Note table not available"}), 503

            # Available years
            year_rows = conn.execute(
                "SELECT DISTINCT year_report FROM note WHERE ticker=? AND period_kind='YEAR' ORDER BY year_report DESC",
                (clean_symbol,),
            ).fetchall()
            years = [r["year_report"] for r in year_rows]
            if not years:
                conn.close()
                return jsonify({"years": [], "year": None, "industry": [], "npl": []})

            req_year = request.args.get("year", type=int)
            year = req_year if req_year in years else years[0]

            row = conn.execute(
                "SELECT * FROM note WHERE ticker=? AND period_kind='YEAR' AND year_report=?",
                (clean_symbol, year),
            ).fetchone()
            conn.close()

            if not row:
                return jsonify({"years": years, "year": year, "industry": [], "npl": []})

            rd = {k: row[k] for k in row.keys()}

            # Industry breakdown — top N + "Khác"
            industry_raw = [
                {"name": label, "value": _to_int(rd.get(field))}
                for field, label in INDUSTRY_FIELDS.items()
                if _to_int(rd.get(field)) > 0
            ]
            industry_raw.sort(key=lambda x: x["value"], reverse=True)
            if len(industry_raw) > _TOP_N_INDUSTRY:
                top = industry_raw[:_TOP_N_INDUSTRY]
                other_val = sum(x["value"] for x in industry_raw[_TOP_N_INDUSTRY:])
                if other_val > 0:
                    top.append({"name": "Khác", "value": other_val})
                industry = top
            else:
                industry = industry_raw

            # NPL breakdown
            npl = [
                {"name": label, "value": _to_int(rd.get(field))}
                for field, label in NPL_FIELDS.items()
                if _to_int(rd.get(field)) > 0
            ]

            return jsonify({"years": years, "year": year, "industry": industry, "npl": npl})

        except Exception as exc:
            logger.exception("loan-breakdown error for %s", clean_symbol)
            return jsonify({"error": str(exc)}), 500
