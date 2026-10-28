"""HTTP cache and CORS metadata for the central public API."""

from __future__ import annotations

import json
import re
from pathlib import Path

from flask import Flask, request

_LIB = Path(__file__).resolve().parents[2] / "frontend-next" / "src" / "lib"
_CONFIG = json.loads((_LIB / "apiCacheRules.json").read_text(encoding="utf-8"))
_ALIASES = json.loads((_LIB / "apiRouteAliases.json").read_text(encoding="utf-8"))
_RULES = [(re.compile(rule["pattern"]), rule) for rule in _CONFIG["rules"]]
_CANONICAL = {}
for _canonical, _legacy in _ALIASES.items():
    _CANONICAL.setdefault(_legacy, _canonical)
for _canonical, _legacy in _ALIASES.items():
    _CANONICAL[_canonical] = _CANONICAL[_legacy]
_CANONICAL.update({
    "/api/company-profile/<symbol>": "/api/companies/<symbol>/description",
    "/api/financial-field-codes": "/api/financials/fields",
    "/api/financial-statements/fields": "/api/financials/fields",
})


def cache_policy(route: str, args) -> str:
    """Classify canonical and legacy Flask route templates identically."""
    route = _CANONICAL.get(route, route)
    resource = route.removeprefix("/api/").strip("/").lower()
    if (args.get("cache") == "no-store" or args.get("nocache") == "1"
            or "pretty" in args or args.get("fetch_price") == "true"):
        return "no-store"
    for pattern, rule in _RULES:
        if not pattern.search(resource):
            continue
        if any(args.get(key) != value for key, value in rule.get("query", {}).items()):
            continue
        excluded = rule.get("unlessQuery")
        if excluded and all(args.get(key) == value for key, value in excluded.items()):
            continue
        return _CONFIG["policies"][rule["mode"]]["responseCacheControl"]
    return "no-store"


def register_api_http(app: Flask) -> None:
    @app.after_request
    def public_api_headers(response):
        if not request.path.startswith("/api/"):
            return response
        route = request.url_rule.rule if request.url_rule else request.path
        policy = cache_policy(route, request.args)
        if request.method not in {"GET", "HEAD"} or response.status_code >= 400:
            policy = "no-store"
        # Explicit freshness/privacy decisions made by handlers take priority.
        # Live data, mutations, errors and unknown endpoints cannot be cached.
        if policy == "no-store" or not response.headers.get("Cache-Control"):
            response.headers["Cache-Control"] = policy
        response.headers["X-Robots-Tag"] = "noindex"
        # Conditional GETs save the entire body when a cacheable JSON payload
        # has not changed. Never buffer file streams or validators for live data.
        cache_control = response.headers.get("Cache-Control", "").lower()
        if (request.method in {"GET", "HEAD"} and response.status_code == 200
                and not any(flag in cache_control for flag in ("no-store", "private"))
                and response.mimetype == "application/json" and not response.is_streamed):
            if not response.get_etag()[0]:
                response.add_etag()
            response.make_conditional(request)
        return response
