from __future__ import annotations

import logging
from typing import Any

import requests as http_requests
from flask import Blueprint, jsonify, request

from backend.data_sources.vci import VCIClient

from .deps import cache_func, cache_ttl
from .http_headers import CAFEF_HEADERS, VCI_HEADERS


logger = logging.getLogger(__name__)

_VCI_INDEX_VALUATION_URL = (
    "https://trading.vietcap.com.vn/api/iq-insight-service/v1/market-watch/index-valuation"
)


_INDEX_ID_TO_VCI_SYMBOL = {
    '1': 'VNINDEX',
    '2': 'HNXIndex',
    '9': 'HNXUpcomIndex',
    '11': 'VN30',
}


def _find_vci_index_item(vci_symbol: str) -> dict | None:
    try:
        items = VCIClient.get_market_indices() or []
    except Exception:
        return None
    vci_symbol_u = str(vci_symbol).upper()
    for it in items:
        try:
            if str(it.get('symbol') or '').upper() == vci_symbol_u:
                return it
        except Exception:
            continue
    return None


def _normalize_metric(metric: str | None) -> str:
    value = str(metric or "both").strip().lower()
    if value in {"pe", "pb", "both"}:
        return value
    return "both"


def _fetch_vci_index_valuation_series(
    *,
    metric: str,
    com_group_code: str = "VNINDEX",
    time_frame: str = "ALL",
) -> list[dict[str, Any]]:
    response = http_requests.get(
        _VCI_INDEX_VALUATION_URL,
        timeout=20,
        headers=VCI_HEADERS,
        params={
            "type": metric,
            "comGroupCode": com_group_code,
            "timeFrame": time_frame,
        },
    )
    response.raise_for_status()
    payload = response.json()
    values = ((payload or {}).get("data") or {}).get("values") or []
    out: list[dict[str, Any]] = []
    for item in values:
        if not isinstance(item, dict):
            continue
        date = str(item.get("date") or "").strip()
        raw_value = item.get("value")
        if not date or raw_value is None:
            continue
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            continue
        out.append({"date": date, "value": value})
    return out


def fetch_vci_index_valuation_payload(
    *,
    metric: str = "both",
    com_group_code: str = "VNINDEX",
    time_frame: str = "ALL",
) -> dict[str, Any]:
    selected = _normalize_metric(metric)
    pe_series: list[dict[str, Any]] = []
    pb_series: list[dict[str, Any]] = []
    if selected in {"pe", "both"}:
        pe_series = _fetch_vci_index_valuation_series(
            metric="pe", com_group_code=com_group_code, time_frame=time_frame
        )
    if selected in {"pb", "both"}:
        pb_series = _fetch_vci_index_valuation_series(
            metric="pb", com_group_code=com_group_code, time_frame=time_frame
        )

    # Keep legacy-friendly keys while exposing normalized PE/PB TTM series.
    return {
        "success": True,
        "source": "VCI",
        "index": com_group_code,
        "timeFrame": time_frame,
        "metric": selected,
        "series": {"pe": pe_series, "pb": pb_series},
        "pe": pe_series,
        "pb": pb_series,
        "Data": pe_series if selected == "pe" else (pb_series if selected == "pb" else pe_series),
        "DataPE": pe_series,
        "DataPB": pb_series,
    }


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/pe-chart")
    @market_bp.route("/index-valuation-chart")
    def api_market_pe_chart():
        metric = _normalize_metric(request.args.get("metric", "both"))
        index = (request.args.get("index") or "VNINDEX").strip().upper()
        time_frame = (request.args.get("timeFrame") or "ALL").strip().upper()
        cache_key = f"index_valuation_{index}_{time_frame}_{metric}"

        def fetch_index_valuation():
            return fetch_vci_index_valuation_payload(
                metric=metric, com_group_code=index, time_frame=time_frame
            )

        try:
            data, is_cached = cache_func()(cache_key, cache_ttl().get("pe_chart", 3600), fetch_index_valuation)
            resp = jsonify(data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as e:
            logger.error(f"Index valuation proxy error: {e}")
            return jsonify({"error": str(e)}), 500

    @market_bp.route("/foreign-flow")
    def api_market_foreign_flow():
        flow_type = request.args.get("type", "buy")
        cache_key = f"foreign_flow_{flow_type}"

        def fetch_foreign_flow():
            url = f"https://cafef.vn/du-lieu/ajax/mobile/smart/ajaxkhoingoai.ashx?type={flow_type}"
            response = http_requests.get(url, timeout=10, headers=CAFEF_HEADERS)
            response.raise_for_status()
            return response.json()

        try:
            data, is_cached = cache_func()(cache_key, cache_ttl().get("realtime", 45), fetch_foreign_flow)
            resp = jsonify(data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as e:
            logger.error(f"Foreign flow proxy error: {e}")
            return jsonify({"Data": [], "Success": False})

    @market_bp.route("/realtime-chart")
    def api_market_realtime_chart():
        return jsonify({"success": False, "error": "Deprecated"}), 410

    @market_bp.route("/realtime-market")
    def api_market_realtime_market():
        return jsonify({"success": False, "error": "Deprecated"}), 410

    @market_bp.route("/realtime")
    def api_market_realtime_legacy():
        return jsonify({"success": False, "error": "Deprecated: use /api/market/vci-indices"}), 410

    @market_bp.route("/indices")
    def api_market_indices_legacy():
        return jsonify({"success": False, "error": "Deprecated: use /api/market/vci-indices"}), 410

    @market_bp.route("/reports")
    def api_market_reports_legacy():
        return jsonify({"success": False, "error": "Deprecated"}), 410
