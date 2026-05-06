from __future__ import annotations

import json
import logging
import os
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

_MODEL = "gemma-4-31b-it"
_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_TIMEOUT = 30


def _api_key() -> str:
    key = os.environ.get("GEMMA_API_KEY", "")
    if not key:
        raise RuntimeError("GEMMA_API_KEY not set")
    return key


def generate(prompt: str) -> str:
    """Call Gemma 4 31B and return the text response."""
    url = f"{_API_BASE}/{_MODEL}:generateContent?key={_api_key()}"
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 512, "temperature": 0.3},
    }).encode()

    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
        data: Any = json.loads(resp.read())

    # Extract only the final non-thought text part
    parts = data["candidates"][0]["content"]["parts"]
    texts = [p["text"] for p in parts if not p.get("thought")]
    return "\n".join(texts).strip()


def build_financial_prompt(
    ticker: str,
    name: str,
    quarter: str,
    revenue: float,
    revenue_yoy: float,
    revenue_qoq: float,
    net_profit: float,
    profit_yoy: float,
    profit_qoq: float,
    gross_margin: float | None,
) -> str:
    def fmt(v: float) -> str:
        if abs(v) >= 1e12:
            return f"{v/1e12:.1f} nghìn tỷ"
        if abs(v) >= 1e9:
            return f"{v/1e9:.1f} tỷ"
        return f"{v/1e6:.0f} triệu"

    def pct(v: float) -> str:
        sign = "+" if v >= 0 else ""
        return f"{sign}{v:.1f}%"

    margin_line = f"- Biên lợi nhuận gộp: {gross_margin:.1f}%" if gross_margin is not None else ""

    return f"""Bạn là chuyên gia phân tích chứng khoán Việt Nam. Hãy phân tích BCTC {quarter} của {name} ({ticker}) trong 3-4 câu tiếng Việt ngắn gọn, chuyên nghiệp. Chỉ trả về đoạn phân tích, không thêm tiêu đề hay gạch đầu dòng.

Dữ liệu:
- Doanh thu thuần: {fmt(revenue)} ({pct(revenue_yoy)} YoY, {pct(revenue_qoq)} QoQ)
- Lợi nhuận sau thuế: {fmt(net_profit)} ({pct(profit_yoy)} YoY, {pct(profit_qoq)} QoQ)
{margin_line}

Nhận xét về xu hướng tăng trưởng, chất lượng lợi nhuận, và tín hiệu đáng chú ý nếu có."""
