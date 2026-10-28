"""Public resources previously implemented only by Next.js API routes."""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import requests
from flask import Blueprint, jsonify, request, send_file

from backend.cache_utils import cache_get_ns, cache_set_ns
from backend.services.polymarket_selection import select_polymarket_events
from backend.services.api_payloads import project_field_codes

logger = logging.getLogger(__name__)
public_resources_bp = Blueprint("public_resources", __name__, url_prefix="/api")
ROOT = Path(__file__).resolve().parents[2]
DETAILS_URL = "https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/details"
GAMMA_URL = "https://gamma-api.polymarket.com/events"


@public_resources_bp.get("/financials/fields")
@public_resources_bp.get("/financial-statements/fields")
@public_resources_bp.get("/financial-field-codes")
def financial_fields():
    path = ROOT / "config" / "vci_field_codes.json"
    if not path.is_file():
        return jsonify(error="Financial field-code map is unavailable"), 404
    if (request.args.get("compact") == "1" or request.args.get("section")
            or request.args.get("fields") or request.args.get("schema") == "2"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            response = jsonify(project_field_codes(data, request.args.get("section"),
                               request.args.get("compact") == "1", request.args.get("fields")))
            response.headers["Cache-Control"] = "public, max-age=86400"
            return response
        except (OSError, json.JSONDecodeError):
            logger.exception("Financial field-code map is unavailable")
            return jsonify(error="Financial field-code map is unavailable"), 503
        except ValueError as error:
            return jsonify(error=str(error)), 400
    return send_file(path, mimetype="application/json", max_age=86400)


@public_resources_bp.get("/companies/<symbol>/description")
@public_resources_bp.get("/company-profile/<symbol>")
def company_description(symbol: str):
    symbol = symbol.upper()
    if not re.fullmatch(r"[A-Z0-9]{1,10}", symbol):
        return jsonify(error="Invalid ticker"), 400
    language = "en" if request.args.get("lang") == "en" else "vi"
    cached = cache_get_ns("company_description", symbol)
    if cached is None:
        try:
            response = requests.get(DETAILS_URL, params={"ticker": symbol}, headers={
                "Accept": "application/json",
                "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8",
                "Origin": "https://trading.vietcap.com.vn",
                "Referer": "https://trading.vietcap.com.vn/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
                "device-id": "7a3c8d9e1f20",
            }, timeout=10)
            response.raise_for_status()
            cached = response.json().get("data")
            if not isinstance(cached, dict):
                cached = {}
            if cached.get("profile") or cached.get("enProfile"):
                cache_set_ns("company_description", symbol, cached, 2592000)
        except (requests.RequestException, ValueError, AttributeError):
            logger.warning("Company description unavailable for %s", symbol)
            cached = {}
    profile = cached.get("enProfile" if language == "en" else "profile")
    profile = profile if isinstance(profile, str) and profile.strip() else None
    result = jsonify(available=bool(profile), profile=profile, source="Vietcap IQ")
    result.headers["Cache-Control"] = (
        "public, max-age=0, s-maxage=2592000, stale-while-revalidate=604800"
        if profile else "no-store"
    )
    return result


@public_resources_bp.get("/market/polymarket-events")
def polymarket_events():
    # Fetch fixed upstream URLs only, sharing raw results between both projections.
    cached = cache_get_ns("polymarket_events", "finance-and-fed")
    if cached is None:
        events = {}
        try:
            for tag in ("finance", "fed-rates"):
                response = requests.get(GAMMA_URL, params={
                    "active": "true", "closed": "false", "tag_slug": tag,
                    "order": "volume24hr", "ascending": "false", "limit": 100,
                }, headers={"Accept": "application/json"}, timeout=10)
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, list):
                    raise ValueError("Unexpected Gamma response")
                for event in payload:
                    if isinstance(event, dict):
                        events[str(event.get("id", len(events)))] = event
            cached = list(events.values())
            cache_set_ns("polymarket_events", "finance-and-fed", cached, 300)
        except (requests.RequestException, ValueError):
            logger.warning("Polymarket events unavailable")
            return jsonify(error="Failed to fetch Polymarket events"), 502
    result = jsonify(select_polymarket_events(cached) if request.args.get("compact") == "1" else cached)
    result.headers["Cache-Control"] = "public, max-age=0, s-maxage=300, stale-while-revalidate=600"
    return result
