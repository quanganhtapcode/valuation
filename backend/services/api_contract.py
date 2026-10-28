"""Opt-in structured JSON contract, serialized before compression and ETags."""

from __future__ import annotations

import json
import re
from pathlib import Path

from flask import Flask, request

from backend.services.api_http import canonical_api_route

_CONFIG = json.loads((Path(__file__).resolve().parents[2] / "frontend-next/src/lib/apiContract.json").read_text())
_RESOURCES = [(name, re.compile(spec["pattern"]), spec["groups"])
              for name, spec in _CONFIG["resources"].items()]


def structured_response(payload, route: str, status: int = 200):
    """Return envelope and a compatibility shape carried in a response header."""
    if status >= 400:
        error = payload.get("error") if isinstance(payload, dict) else None
        if not isinstance(error, dict):
            error = {"code": "REQUEST_FAILED", "message": str(error or "Request failed")}
        return {"error": error}, "error"
    if not isinstance(payload, dict):
        return {"data": payload}, "list" if isinstance(payload, list) else "value"

    data = dict(payload)
    flags = []
    if data.get("success") is True:
        data.pop("success")
        flags.append("success")
    container = next((key for key in _CONFIG["collections"] if key in data), None)
    if container:
        items = data.pop(container)
        if isinstance(items, list) and data.get("count") == len(items) and type(data.get("count")) is int:
            data.pop("count")
            flags.append("count")
        envelope = {"data": items}
        if data:
            envelope["meta"] = data
        return envelope, ";".join([container, *flags])

    meta = {key: data.pop(key) for key in _CONFIG["metadata"] if key in data}
    shape = "object"
    route = canonical_api_route(route)
    for name, pattern, groups in _RESOURCES:
        if not pattern.fullmatch(route) or any(group in data for group in groups):
            continue
        shape = name
        for token, duplicate in _CONFIG.get("duplicate_sets", {}).items():
            canonical = duplicate["canonical"]
            aliases = duplicate["aliases"]
            if (duplicate["resource"] == name and canonical in data
                    and all(alias in data and type(data[alias]) is type(data[canonical])
                            and data[alias] == data[canonical] for alias in aliases)):
                for alias in aliases:
                    data.pop(alias)
                flags.append(token)
        for group, mapping in groups.items():
            values = {key: data.pop(original) for key, original in mapping.items() if original in data}
            if values:
                data[group] = values
        if name == "quote":
            book = data.get("orderbook")
            if (isinstance(book, dict) and set(book) == {"bid", "ask"}
                    and all(isinstance(book[side], list) for side in ("bid", "ask"))
                    and all(isinstance(level, dict) and set(level) == {"price", "volume"}
                            for side in ("bid", "ask") for level in book[side])):
                data["orderbook"] = {"columns": ["price", "volume"],
                                     **{side: [[level["price"], level["volume"]] for level in book[side]]
                                        for side in ("bid", "ask")}}
        break
    envelope = {"data": data}
    if meta:
        envelope["meta"] = meta
    return envelope, ";".join([shape, *flags])


def register_api_contract(app: Flask) -> None:
    @app.after_request
    def public_json_contract(response):
        if (request.args.get("schema") != "2" or not request.path.startswith("/api/")
                or response.mimetype != "application/json" or response.is_streamed
                or response.status_code in {204, 304}
                or response.headers.get("Content-Disposition", "").startswith("attachment")):
            return response
        payload = response.get_json(silent=True)
        if payload is None and response.get_data().strip() != b"null":
            return response
        route = request.url_rule.rule if request.url_rule else request.path
        envelope, shape = structured_response(payload, route, response.status_code)
        pretty = request.args.get("pretty", "").lower() in {"1", "true", "yes"}
        response.set_data(app.json.dumps(envelope, indent=2 if pretty else None,
                                        separators=None if pretty else (",", ":")))
        response.headers.pop("ETag", None)
        response.headers["X-API-Schema"] = "2"
        response.headers["X-API-Shape"] = shape
        return response
