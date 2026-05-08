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
        "generationConfig": {"maxOutputTokens": 1024, "temperature": 0.3},
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
    # Core financials (from income_statement)
    revenue: float,
    revenue_yoy: float,
    revenue_qoq: float,
    net_profit: float,
    profit_yoy: float,
    profit_qoq: float,
    gross_margin: float | None = None,
    # Market context (from screening + company DB)
    current_price: float | None = None,
    target_price: float | None = None,
    upside_pct: float | None = None,
    recommendation_action: str | None = None,
    pe_ttm: float | None = None,
    pb_ttm: float | None = None,
    roe_ttm: float | None = None,
    # Historical PE/PB averages (from stats_financial_history)
    pe_2yr_avg: float | None = None,
    pb_2yr_avg: float | None = None,
    pe_5yr_avg: float | None = None,
    pb_5yr_avg: float | None = None,
    roe_avg: float | None = None,
    dividend_yield_avg: float | None = None,
    # Sector averages (from screening_data peer group)
    pe_sector: float | None = None,
    pb_sector: float | None = None,
    # Technical context (from vci_technical.sqlite)
    technical: dict | None = None,
    # Forecast years (from vci_financial_data_years)
    forecast_years: list[dict] | None = None,
    # Recent news
    news: list[dict] | None = None,
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

    # ── Section 1: Core financials ────────────────────────────────────────
    margin_line = f"- Biên lợi nhuận gộp: {gross_margin:.1f}%\n" if gross_margin is not None else ""
    financials_block = (
        f"Dữ liệu BCTC {quarter}:\n"
        f"- Doanh thu thuần: {fmt(revenue)} ({pct(revenue_yoy)} YoY, {pct(revenue_qoq)} QoQ)\n"
        f"- Lợi nhuận sau thuế: {fmt(net_profit)} ({pct(profit_yoy)} YoY, {pct(profit_qoq)} QoQ)\n"
        f"{margin_line}"
    )

    # ── Section 2: Market context & valuation ────────────────────────────
    valuation_lines = ["Định giá & thị trường:"]
    if current_price:
        valuation_lines.append(f"- Giá hiện tại: {current_price:,.0f}")
    if target_price:
        upside_str = f" (upside {upside_pct:+.1f}%)" if upside_pct is not None else ""
        valuation_lines.append(f"- Giá mục tiêu: {target_price:,.0f}{upside_str}")
    if pe_ttm:
        valuation_lines.append(f"- P/E TTM: {pe_ttm:.1f}x | P/B TTM: {pb_ttm:.1f}x" if pb_ttm else f"- P/E TTM: {pe_ttm:.1f}x")
    if pe_2yr_avg:
        valuation_lines.append(f"- P/E trung bình 2 năm: {pe_2yr_avg:.1f}x | P/B: {pb_2yr_avg:.1f}x" if pb_2yr_avg else f"- P/E trung bình 2 năm: {pe_2yr_avg:.1f}x")
    if pe_5yr_avg:
        valuation_lines.append(f"- P/E trung bình 5 năm: {pe_5yr_avg:.1f}x | P/B: {pb_5yr_avg:.1f}x" if pb_5yr_avg else f"- P/E trung bình 5 năm: {pe_5yr_avg:.1f}x")
    if pe_sector:
        valuation_lines.append(f"- P/E trung bình ngành: {pe_sector:.1f}x | P/B: {pb_sector:.1f}x" if pb_sector else f"- P/E trung bình ngành: {pe_sector:.1f}x")
    if roe_avg:
        valuation_lines.append(f"- ROE trung bình 5 năm: {roe_avg:.1f}%")
    if dividend_yield_avg:
        valuation_lines.append(f"- Lợi suất cổ tức trung bình: {dividend_yield_avg:.1f}%")
    valuation_block = "\n".join(valuation_lines)

    # ── Section 3: Technical ─────────────────────────────────────────────
    tech_block = ""
    if technical:
        ma_r = technical.get("ma_rating", "")
        osc_r = technical.get("osc_rating", "")
        ma_vals = technical.get("ma_values") or {}
        ma_str = ", ".join(f"{k}={v:,.0f}" for k, v in sorted(ma_vals.items())) if ma_vals else ""
        tech_block = (
            f"\nTín hiệu kỹ thuật (ngày):\n"
            f"- Tín hiệu đường trung bình: {ma_r}\n"
            f"- Tín hiệu dao động (oscillator): {osc_r}\n"
            + (f"- Các MA chính: {ma_str}\n" if ma_str else "")
        )

    # ── Section 4: Forecast years ────────────────────────────────────────
    forecast_block = ""
    if forecast_years:
        lines = ["\nDữ liệu tài chính nhiều năm (actuals + dự báo analyst):"]
        lines.append(f"{'Năm':<8} {'DT tăng trưởng':>16} {'LNST tăng trưởng':>18} {'P/E':>7} {'P/B':>7} {'ROE':>7}")
        for yr in forecast_years:
            tag = "[F]" if yr.get("is_forecast") else "   "
            rg = f"{yr['revenue_growth']:+.1f}%" if yr.get("revenue_growth") is not None else "N/A"
            pg = f"{yr['profit_growth']:+.1f}%" if yr.get("profit_growth") is not None else "N/A"
            pe_ = f"{yr['pe']:.1f}x" if yr.get("pe") else "N/A"
            pb_ = f"{yr['pb']:.1f}x" if yr.get("pb") else "N/A"
            roe_ = f"{yr['roe']:.1f}%" if yr.get("roe") else "N/A"
            lines.append(f"{yr['year']}{tag:<3} {rg:>16} {pg:>18} {pe_:>7} {pb_:>7} {roe_:>7}")
        forecast_block = "\n".join(lines)

    # ── Section 5: News ───────────────────────────────────────────────────
    news_block = ""
    if news:
        lines = ["\nTin tức gần đây (dùng [id] để trích dẫn):"]
        for item in news:
            tag = f" [{item['sentiment']}]" if item.get("sentiment") else ""
            lines.append(f"[{item['id']}] {item['date']}{tag} {item['title']} — {item['summary'][:120]}")
        news_block = "\n".join(lines)

    citation_note = (
        "\n- Trong analysis và risks, trích dẫn tin tức bằng [id] nếu liên quan"
        if news else ""
    )

    # ── JSON schema ───────────────────────────────────────────────────────
    rec_action = recommendation_action or "Theo dõi"
    rec_tp = int(target_price) if target_price else "null"
    rec_up = f"{upside_pct:.1f}" if upside_pct is not None else "null"

    schema = """{
  "summary": "1-2 câu tóm tắt kết quả kinh doanh và điểm nổi bật nhất",
  "technical": {
    "trend": "Mô tả ngắn xu hướng và hỗ trợ/kháng cự",
    "support": <số nguyên hoặc null>,
    "resistance": <số nguyên hoặc null>
  },
  "recommendation": {
    "action": "Mua|Tích lũy|Theo dõi|Giảm tỷ trọng",
    "target_price": <số nguyên hoặc null>,
    "upside_pct": <số thực hoặc null>
  },
  "growth_table": [
    {"period": "2023", "revenue_growth": 12.1, "profit_growth": 8.2, "is_forecast": false}
  ],
  "valuation": {
    "pe_ttm": <số thực hoặc null>,
    "pb_ttm": <số thực hoặc null>,
    "pe_2yr_avg": <số thực hoặc null>,
    "pb_2yr_avg": <số thực hoặc null>,
    "pe_5yr_avg": <số thực hoặc null>,
    "pb_5yr_avg": <số thực hoặc null>,
    "pe_sector": <số thực hoặc null>,
    "pb_sector": <số thực hoặc null>,
    "pe_commentary": "1 câu nhận xét P/E so với lịch sử và ngành",
    "pb_commentary": "1 câu nhận xét P/B so với lịch sử và ngành"
  },
  "risks": ["Rủi ro 1", "Rủi ro 2"],
  "analysis": "Phân tích narrative 3-5 câu về triển vọng, driver tăng trưởng, và bối cảnh ngành",
  "long_term": {
    "eps_cagr_3yr": <số thực hoặc null>,
    "eps_cagr_label": "cao|tốt|trung bình|thấp",
    "roe_avg": <số thực hoặc null>,
    "roe_label": "xuất sắc|tốt|trung bình|yếu",
    "dividend_yield_avg": <số thực hoặc null>,
    "dividend_yield_label": "hấp dẫn|khá|không đáng kể"
  }
}"""

    return f"""Bạn là chuyên gia phân tích chứng khoán Việt Nam. Phân tích toàn diện {name} ({ticker}).

{financials_block}
{valuation_block}{tech_block}{forecast_block}{news_block}

Trả về JSON hợp lệ theo đúng cấu trúc sau, không thêm bất kỳ text nào ngoài JSON:
{schema}

Yêu cầu:
- summary: 1-2 câu, nêu điểm nổi bật nhất của kỳ báo cáo
- technical.support / technical.resistance: ước tính từ dữ liệu MA (để null nếu không rõ)
- recommendation: dùng action="{rec_action}", target_price={rec_tp}, upside_pct={rec_up}
- growth_table: điền từ dữ liệu thực tế được cung cấp, đánh dấu is_forecast=true cho các năm dự báo
- valuation: điền đúng các số đã cho, pe_commentary / pb_commentary 1 câu mỗi cái
- risks: 1-3 rủi ro cụ thể nhất, dựa trên dữ liệu và ngành{citation_note}
- analysis: narrative 3-5 câu về driver tăng trưởng, NIM/margin, áp lực cạnh tranh, bối cảnh vĩ mô
- long_term.eps_cagr_3yr: tính từ EPS trong bảng nếu có (tăng trưởng kép 3 năm gần nhất)
- Toàn bộ bằng tiếng Việt, chuyên nghiệp"""
