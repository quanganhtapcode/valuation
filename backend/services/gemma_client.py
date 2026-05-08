from __future__ import annotations

import json
import logging
import os
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

# Fallback chain: try models in order until one succeeds
_MODEL_CHAIN = [
    "gemma-4-31b-it",
    "gemma-4-26b-a4b-it",
]
_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_TIMEOUT = 45
_QUOTA_EXCEEDED = {429}   # permanently skip model this run
_TRANSIENT_ERRORS = {500, 503}  # retry once with backoff, then skip


def _api_key() -> str:
    key = os.environ.get("GEMMA_API_KEY", "")
    if not key:
        raise RuntimeError("GEMMA_API_KEY not set")
    return key


def _call_model(model: str, prompt: str) -> str:
    url = f"{_API_BASE}/{model}:generateContent?key={_api_key()}"
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 512, "temperature": 0.3},
    }).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
        data: Any = json.loads(resp.read())
    parts = data["candidates"][0]["content"]["parts"]
    texts = [p["text"] for p in parts if not p.get("thought")]
    return "\n".join(texts).strip()


_quota_exceeded_models: set[str] = set()  # 429 = skip for entire run


def generate(prompt: str) -> tuple[str, str]:
    """Try each model in the fallback chain. Returns (response_text, model_used).

    - 429: model is quota-exhausted, skip for the rest of this run.
    - 500/503: transient, sleep 8s and retry once before moving on.
    """
    import time
    last_err: Exception | None = None

    for model in _MODEL_CHAIN:
        if model in _quota_exceeded_models:
            continue
        for attempt in range(2):
            try:
                result = _call_model(model, prompt)
                if model != _MODEL_CHAIN[0]:
                    logger.info(f"Used fallback model: {model}")
                return result, model
            except urllib.error.HTTPError as e:
                if e.code in _QUOTA_EXCEEDED:
                    logger.warning(f"Model {model} quota exceeded (429), skipping for this run")
                    _quota_exceeded_models.add(model)
                    break
                if e.code in _TRANSIENT_ERRORS and attempt == 0:
                    logger.warning(f"Model {model} transient error {e.code}, retrying in 8s")
                    time.sleep(8)
                    last_err = e
                    continue
                last_err = e
                break

    raise RuntimeError(f"All models exhausted. Last error: {last_err}")


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
    news: list[dict] | None = None,
    **kwargs,
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

    news_block = ""
    if news:
        lines = ["\nTin tức thị trường gần đây (dùng [id] để trích dẫn):"]
        for item in news:
            sentiment_tag = f" [{item['sentiment']}]" if item.get("sentiment") else ""
            lines.append(f"[{item['id']}] {item['date']}{sentiment_tag} {item['title']} — {item['summary'][:120]}")
        news_block = "\n".join(lines)

    citations_instruction = (
        "\n- Trong positive_view và negative_view, trích dẫn tin tức bằng [id] nếu có liên quan"
        if news else ""
    )

    return f"""Bạn là chuyên gia phân tích chứng khoán Việt Nam. Hãy phân tích BCTC {quarter} của {name} ({ticker}).

Dữ liệu tài chính:
- Doanh thu thuần: {fmt(revenue)} ({pct(revenue_yoy)} YoY, {pct(revenue_qoq)} QoQ)
- Lợi nhuận sau thuế: {fmt(net_profit)} ({pct(profit_yoy)} YoY, {pct(profit_qoq)} QoQ)
{margin_line}{news_block}

Trả về JSON hợp lệ theo đúng cấu trúc sau, không thêm bất kỳ text nào ngoài JSON:
{{
  "summary": "1-2 câu tóm tắt kết quả kinh doanh",
  "key_issues": [
    {{
      "issue": "Tên vấn đề/câu hỏi quan trọng về doanh nghiệp",
      "positive_view": "Luận điểm tích cực dựa trên dữ liệu BCTC và bối cảnh ngành",
      "negative_view": "Luận điểm tiêu cực hoặc rủi ro cần chú ý"
    }}
  ]
}}

Yêu cầu:
- summary: 1-2 câu, nêu điểm nổi bật nhất
- key_issues: đúng 2-3 vấn đề quan trọng nhất, mỗi view 1-2 câu, cụ thể và dựa trên số liệu{citations_instruction}
- Toàn bộ bằng tiếng Việt, chuyên nghiệp"""
