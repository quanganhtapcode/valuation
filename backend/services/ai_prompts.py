from __future__ import annotations

import re


def _sanitize(text: str) -> str:
    """Normalize Unicode chars that cause AI provider API errors."""
    if not text:
        return text
    replacements = {
        "“": '"', "”": '"',
        "‘": "'", "’": "'",
        "–": "-", "—": "-",
        "…": "...",
        " ": " ",
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    return re.sub(r"[^\x00-ɏḀ-ỿ -⁯]", "", text)


def build_combined_prompt(
    ticker: str,
    name: str,
    sector: str,
    quarter: str,
    # Core financials
    revenue: float,
    revenue_yoy: float,
    profit_yoy: float,
    gross_margin: float | None = None,
    # Market context
    current_price: float | None = None,
    pe_ttm: float | None = None,
    pb_ttm: float | None = None,
    roe_ttm: float | None = None,
    # Historical PE/PB averages
    pe_2yr_avg: float | None = None,
    pb_2yr_avg: float | None = None,
    pe_5yr_avg: float | None = None,
    pb_5yr_avg: float | None = None,
    # Sector averages
    pe_sector: float | None = None,
    pb_sector: float | None = None,
    # Technical
    technical: dict | None = None,
    # Forecast years
    forecast_years: list[dict] | None = None,
    # ValuationService model outputs
    valuation_models: dict | None = None,
    # Broker recommendation
    recommendation_action: str | None = None,
    target_price: float | None = None,
    upside_pct: float | None = None,
    # News
    news: list[dict] | None = None,
) -> str:
    """Single prompt returning both valuation analysis + news thesis. Saves 1 API call/ticker."""

    def pct(v: float) -> str:
        sign = "+" if v >= 0 else ""
        return f"{sign}{v:.1f}%"

    # ── Financials ────────────────────────────────────────────────────────
    fin_line = (
        f"Tài chính {quarter}: DT {pct(revenue_yoy)} YoY | LNST {pct(profit_yoy)} YoY"
        + (f" | Biên gộp {gross_margin:.1f}%" if gross_margin else "")
    )

    # ── Valuation context ─────────────────────────────────────────────────
    val_parts = []
    if current_price:
        val_parts.append(f"Giá: {current_price:,.0f}")
    if pe_ttm:
        val_parts.append(f"P/E TTM: {pe_ttm:.1f}x" + (f" | P/B: {pb_ttm:.1f}x" if pb_ttm else ""))
    if pe_2yr_avg:
        val_parts.append(f"P/E TB2yr: {pe_2yr_avg:.1f}x" + (f" / TB5yr: {pe_5yr_avg:.1f}x" if pe_5yr_avg else ""))
    if pe_sector:
        val_parts.append(f"P/E ngành: {pe_sector:.1f}x" + (f" | P/B ngành: {pb_sector:.1f}x" if pb_sector else ""))
    if roe_ttm:
        val_parts.append(f"ROE: {roe_ttm:.1f}%")
    val_block = " | ".join(val_parts)

    # ── Valuation models ──────────────────────────────────────────────────
    models_block = ""
    if valuation_models:
        v = valuation_models
        parts = []
        model_map = [
            ("FCFE", v.get("fcfe")), ("FCFF", v.get("fcff")),
            ("Justified P/E", v.get("justified_pe")), ("Justified P/B", v.get("justified_pb")),
            ("Graham", v.get("graham")), ("Avg", v.get("weighted_average")),
        ]
        for label, val in model_map:
            if val:
                up = ((val - current_price) / current_price * 100) if current_price and current_price > 0 else None
                parts.append(f"{label}: {val:,.0f}" + (f"({pct(up)})" if up is not None else ""))
        if v.get("fair_value_range"):
            r = v["fair_value_range"]
            if r.get("low_pe") and r.get("high_pe"):
                parts.append(f"PE-range: {r['low_pe']:,.0f}-{r['high_pe']:,.0f}")
        models_block = "\nMô hình: " + " | ".join(parts)

    # ── Forecast ──────────────────────────────────────────────────────────
    forecast_block = ""
    if forecast_years:
        rows = []
        for yr in forecast_years[-4:]:
            tag = "[F]" if yr.get("is_forecast") else ""
            rg = f"{yr['revenue_growth']:+.1f}%" if yr.get("revenue_growth") is not None else "N/A"
            pg = f"{yr['profit_growth']:+.1f}%" if yr.get("profit_growth") is not None else "N/A"
            pe_ = f"{yr['pe']:.1f}x" if yr.get("pe") else "N/A"
            rows.append(f"{yr['year']}{tag} DT:{rg} LN:{pg} PE:{pe_}")
        forecast_block = "\nForecast: " + " | ".join(rows)

    # ── Technical ─────────────────────────────────────────────────────────
    tech_block = ""
    if technical:
        ma_r = technical.get("ma_rating", "")
        osc_r = technical.get("osc_rating", "")
        ma_vals = technical.get("ma_values") or {}
        ma_str = " ".join(f"{k}={v:,.0f}" for k, v in sorted(ma_vals.items())) if ma_vals else ""
        tech_block = f"\nKỹ thuật: MA={ma_r} | Osc={osc_r}" + (f" | {ma_str}" if ma_str else "")

    # ── Broker ────────────────────────────────────────────────────────────
    broker_block = ""
    if target_price or recommendation_action:
        parts = []
        if recommendation_action:
            parts.append(recommendation_action)
        if target_price:
            up_str = f"({upside_pct:+.1f}%)" if upside_pct is not None else ""
            parts.append(f"TP: {target_price:,.0f}{up_str}")
        broker_block = "\nBroker: " + " | ".join(parts)

    # ── News ──────────────────────────────────────────────────────────────
    news_block = ""
    if news:
        lines = ["\nTin tức gần đây:"]
        for item in news:
            tag = f"[{item['sentiment']}]" if item.get("sentiment") else ""
            title = _sanitize(item.get("title", ""))[:80]
            lines.append(f"[{item['id']}]{item['date']}{tag} {title}")
        news_block = "\n".join(lines)

    schema = """{
  "valuation": {
    "valuation_summary": "2-3 câu đánh giá định giá so với lịch sử và ngành",
    "pe_assessment": "rẻ|hợp lý|đắt",
    "pb_assessment": "rẻ|hợp lý|đắt",
    "model_consensus": "1 câu nhận xét hội tụ các mô hình",
    "target_price": <số nguyên>,
    "target_rationale": "1-2 câu giải thích target price",
    "recommendation": "Mua|Tích lũy|Theo dõi|Giảm tỷ trọng",
    "upside_pct": <số thực>,
    "timing": "Ngay bây giờ|Chờ pullback|Chờ xác nhận",
    "technical": {
      "trend": "Mô tả xu hướng ngắn",
      "support": <số nguyên hoặc null>,
      "resistance": <số nguyên hoặc null>,
      "signal": "Tích cực|Trung tính|Tiêu cực"
    },
    "valuation_table": {
      "pe_ttm": <số thực hoặc null>, "pe_2yr_avg": <số thực hoặc null>,
      "pe_5yr_avg": <số thực hoặc null>, "pe_sector": <số thực hoặc null>,
      "pb_ttm": <số thực hoặc null>, "pb_2yr_avg": <số thực hoặc null>,
      "pb_5yr_avg": <số thực hoặc null>, "pb_sector": <số thực hoặc null>,
      "pe_commentary": "1 câu", "pb_commentary": "1 câu"
    }
  },
  "news_thesis": {
    "overall_sentiment": "bullish|mixed|bearish",
    "summary": "1 câu tổng hợp tình hình",
    "bull_case": [{"point": "...", "news_ids": []}],
    "bear_case": [{"point": "...", "news_ids": []}],
    "key_events": ["sự kiện 1", "sự kiện 2"],
    "watch_out": "1 câu điều cần theo dõi"
  }
}"""

    return f"""Bạn là chuyên gia phân tích chứng khoán Việt Nam. Phân tích {name} ({ticker}), ngành {sector}.

{fin_line}
{val_block}{models_block}{forecast_block}{tech_block}{broker_block}{news_block}

Trả về JSON hợp lệ theo đúng cấu trúc sau, không thêm bất kỳ text nào ngoài JSON:
{schema}

Yêu cầu valuation:
- target_price: tổng hợp các mô hình (FCFE/FCFF/PE/PB/Graham), ưu tiên mô hình hội tụ, loại outlier
- recommendation dựa trên upside và kỹ thuật; timing: "Ngay bây giờ" nếu hấp dẫn + kỹ thuật tốt
- pe_assessment/pb_assessment: so TTM vs lịch sử và ngành

Yêu cầu news_thesis:
- bull_case 2-3 điểm mạnh nhất kèm news_ids; bear_case 2-3 rủi ro kèm news_ids
- key_events: 2-3 sự kiện/catalyst quan trọng; watch_out: 1 câu theo dõi tiếp
- Nếu không có tin tức: overall_sentiment="mixed", bull_case=[], bear_case=[], key_events=[], watch_out="Chờ cập nhật thêm tin tức"

Toàn bộ bằng tiếng Việt, chuyên nghiệp"""


def build_news_prompt(
    ticker: str,
    name: str,
    sector: str,
    news: list[dict],
    revenue_yoy: float | None = None,
    profit_yoy: float | None = None,
) -> str:
    """Prompt tổng hợp tin tức → Bull/Bear investment thesis."""
    fin_ctx = ""
    if revenue_yoy is not None or profit_yoy is not None:
        parts = []
        if revenue_yoy is not None:
            sign = "+" if revenue_yoy >= 0 else ""
            parts.append(f"Doanh thu YoY: {sign}{revenue_yoy:.1f}%")
        if profit_yoy is not None:
            sign = "+" if profit_yoy >= 0 else ""
            parts.append(f"LNST YoY: {sign}{profit_yoy:.1f}%")
        fin_ctx = "Bối cảnh tài chính gần nhất: " + ", ".join(parts) + "\n\n"

    news_lines = []
    for item in news:
        tag = f" [{item['sentiment']}]" if item.get("sentiment") else ""
        title = _sanitize(item.get("title", ""))
        summary = _sanitize(item.get("summary", "") or "")
        news_lines.append(
            f"[{item['id']}] {item['date']}{tag} {title}"
            + (f" - {summary[:120]}" if summary else "")
        )
    news_block = "\n".join(news_lines) if news_lines else "(không có tin tức)"

    schema = """{
  "overall_sentiment": "bullish|mixed|bearish",
  "summary": "1 câu tổng hợp tình hình và tâm lý thị trường với cổ phiếu này",
  "bull_case": [
    {"point": "Luận điểm tích cực 1-2 câu", "news_ids": ["id1"]}
  ],
  "bear_case": [
    {"point": "Luận điểm tiêu cực 1-2 câu", "news_ids": ["id2"]}
  ],
  "key_events": ["Sự kiện quan trọng 1", "Sự kiện quan trọng 2"],
  "watch_out": "1 câu: điều quan trọng nhất cần theo dõi tiếp theo"
}"""

    return f"""Bạn là chuyên gia phân tích chứng khoán Việt Nam. Tổng hợp luận điểm đầu tư cho {name} ({ticker}), ngành {sector}.

{fin_ctx}Tin tức gần đây (dùng [id] để trích dẫn):
{news_block}

Trả về JSON hợp lệ theo đúng cấu trúc sau, không thêm bất kỳ text nào ngoài JSON:
{schema}

Yêu cầu:
- overall_sentiment: đánh giá tổng từ toàn bộ tin tức
- bull_case: 2-3 điểm tích cực mạnh nhất, mỗi điểm kèm news_ids liên quan
- bear_case: 2-3 rủi ro/tiêu cực rõ ràng nhất, kèm news_ids
- key_events: 2-3 sự kiện/catalyst quan trọng nhất trong tin tức
- watch_out: 1 câu về điều cần theo dõi trong 1-3 tháng tới
- Toàn bộ bằng tiếng Việt, chuyên nghiệp, dựa hoàn toàn vào tin tức được cung cấp"""


def build_valuation_prompt(
    ticker: str,
    name: str,
    quarter: str,
    # Core financials
    revenue: float,
    revenue_yoy: float,
    profit_yoy: float,
    gross_margin: float | None = None,
    # Market context
    current_price: float | None = None,
    pe_ttm: float | None = None,
    pb_ttm: float | None = None,
    roe_ttm: float | None = None,
    # Historical PE/PB averages
    pe_2yr_avg: float | None = None,
    pb_2yr_avg: float | None = None,
    pe_5yr_avg: float | None = None,
    pb_5yr_avg: float | None = None,
    # Sector averages
    pe_sector: float | None = None,
    pb_sector: float | None = None,
    # Technical
    technical: dict | None = None,
    # Forecast years (for forward PE/PB)
    forecast_years: list[dict] | None = None,
    # ValuationService model outputs
    valuation_models: dict | None = None,
    # Recommendation from screening
    recommendation_action: str | None = None,
    target_price: float | None = None,
    upside_pct: float | None = None,
) -> str:
    """Prompt phân tích định giá → recommendation + target price."""

    def pct(v: float) -> str:
        sign = "+" if v >= 0 else ""
        return f"{sign}{v:.1f}%"

    # ── Valuation context ──────────────────────────────────────────────────
    val_lines = ["Định giá hiện tại:"]
    if current_price:
        val_lines.append(f"- Giá hiện tại: {current_price:,.0f}")
    if pe_ttm:
        val_lines.append(f"- P/E TTM: {pe_ttm:.1f}x" + (f" | P/B TTM: {pb_ttm:.1f}x" if pb_ttm else ""))
    if pe_2yr_avg:
        val_lines.append(f"- P/E TB 2 năm: {pe_2yr_avg:.1f}x" + (f" | P/B: {pb_2yr_avg:.1f}x" if pb_2yr_avg else ""))
    if pe_5yr_avg:
        val_lines.append(f"- P/E TB 5 năm: {pe_5yr_avg:.1f}x" + (f" | P/B: {pb_5yr_avg:.1f}x" if pb_5yr_avg else ""))
    if pe_sector:
        val_lines.append(f"- P/E ngành: {pe_sector:.1f}x" + (f" | P/B ngành: {pb_sector:.1f}x" if pb_sector else ""))
    if roe_ttm:
        val_lines.append(f"- ROE TTM: {roe_ttm:.1f}%")
    val_block = "\n".join(val_lines)

    # ── Valuation models ───────────────────────────────────────────────────
    models_block = ""
    if valuation_models:
        v = valuation_models
        lines = ["\nMô hình định giá (tính toán từ dữ liệu tài chính):"]
        model_map = [
            ("FCFE (Dòng tiền vốn chủ)", v.get("fcfe")),
            ("FCFF (Dòng tiền toàn DN)", v.get("fcff")),
            ("Justified P/E (so sánh PE ngành)", v.get("justified_pe")),
            ("Justified P/B (so sánh PB ngành)", v.get("justified_pb")),
            ("Graham Formula", v.get("graham")),
            ("Bình quân gia quyền", v.get("weighted_average")),
        ]
        for label, val in model_map:
            if val:
                upside = ((val - current_price) / current_price * 100) if current_price and current_price > 0 else None
                upside_str = f" ({pct(upside)})" if upside is not None else ""
                lines.append(f"- {label}: {val:,.0f}{upside_str}")
        if v.get("fair_value_range"):
            r = v["fair_value_range"]
            if r.get("low_pe") and r.get("high_pe"):
                lines.append(f"- Vùng hợp lý PE-based: {r['low_pe']:,.0f} – {r['high_pe']:,.0f}")
            if r.get("low_pb") and r.get("high_pb"):
                lines.append(f"- Vùng hợp lý PB-based: {r['low_pb']:,.0f} – {r['high_pb']:,.0f}")
        models_block = "\n".join(lines)

    # ── Forecast PE/PB ────────────────────────────────────────────────────
    forecast_block = ""
    if forecast_years:
        lines = ["\nDữ liệu dự báo analyst:"]
        lines.append(f"{'Năm':<8} {'DT tăng':>12} {'LN tăng':>12} {'P/E':>7} {'P/B':>7}")
        for yr in forecast_years[-4:]:
            tag = "[F]" if yr.get("is_forecast") else "   "
            rg = f"{yr['revenue_growth']:+.1f}%" if yr.get("revenue_growth") is not None else "N/A"
            pg = f"{yr['profit_growth']:+.1f}%" if yr.get("profit_growth") is not None else "N/A"
            pe_ = f"{yr['pe']:.1f}x" if yr.get("pe") else "N/A"
            pb_ = f"{yr['pb']:.1f}x" if yr.get("pb") else "N/A"
            lines.append(f"{yr['year']}{tag:<3} {rg:>12} {pg:>12} {pe_:>7} {pb_:>7}")
        forecast_block = "\n".join(lines)

    # ── Technical ─────────────────────────────────────────────────────────
    tech_block = ""
    if technical:
        ma_r = technical.get("ma_rating", "")
        osc_r = technical.get("osc_rating", "")
        ma_vals = technical.get("ma_values") or {}
        ma_str = ", ".join(f"{k}={v:,.0f}" for k, v in sorted(ma_vals.items())) if ma_vals else ""
        tech_block = (
            f"\nKỹ thuật:\n- MA rating: {ma_r}\n- Oscillator: {osc_r}"
            + (f"\n- MAs: {ma_str}" if ma_str else "")
        )

    # ── Broker recommendation ─────────────────────────────────────────────
    broker_block = ""
    if target_price or recommendation_action:
        parts = []
        if recommendation_action:
            parts.append(f"Khuyến nghị broker: {recommendation_action}")
        if target_price:
            up_str = f" (upside {upside_pct:+.1f}%)" if upside_pct is not None else ""
            parts.append(f"Giá mục tiêu broker: {target_price:,.0f}{up_str}")
        broker_block = "\n" + " | ".join(parts)

    # ── JSON schema ───────────────────────────────────────────────────────
    schema = """{
  "valuation_summary": "2-3 câu: định giá cổ phiếu đang ở mức nào so với lịch sử và ngành",
  "pe_assessment": "rẻ|hợp lý|đắt",
  "pb_assessment": "rẻ|hợp lý|đắt",
  "model_consensus": "1 câu nhận xét về sự đồng thuận giữa các mô hình",
  "target_price": <số nguyên — giá mục tiêu AI ước tính dựa trên tổng hợp các mô hình>,
  "target_rationale": "1-2 câu giải thích logic target price",
  "recommendation": "Mua|Tích lũy|Theo dõi|Giảm tỷ trọng",
  "upside_pct": <số thực>,
  "timing": "Ngay bây giờ|Chờ pullback|Chờ xác nhận",
  "technical": {
    "trend": "Mô tả xu hướng ngắn gọn",
    "support": <số nguyên hoặc null>,
    "resistance": <số nguyên hoặc null>,
    "signal": "Tích cực|Trung tính|Tiêu cực"
  },
  "valuation_table": {
    "pe_ttm": <số thực hoặc null>,
    "pe_2yr_avg": <số thực hoặc null>,
    "pe_5yr_avg": <số thực hoặc null>,
    "pe_sector": <số thực hoặc null>,
    "pb_ttm": <số thực hoặc null>,
    "pb_2yr_avg": <số thực hoặc null>,
    "pb_5yr_avg": <số thực hoặc null>,
    "pb_sector": <số thực hoặc null>,
    "pe_commentary": "1 câu P/E vs lịch sử/ngành",
    "pb_commentary": "1 câu P/B vs lịch sử/ngành"
  }
}"""

    return f"""Bạn là chuyên gia phân tích định giá chứng khoán Việt Nam. Phân tích định giá toàn diện {name} ({ticker}) kỳ {quarter}.

Tài chính: Doanh thu {pct(revenue_yoy)} YoY | LNST {pct(profit_yoy)} YoY{f' | Biên gộp {gross_margin:.1f}%' if gross_margin else ''}

{val_block}{models_block}{forecast_block}{tech_block}{broker_block}

Trả về JSON hợp lệ theo đúng cấu trúc sau, không thêm bất kỳ text nào ngoài JSON:
{schema}

Yêu cầu:
- target_price: tổng hợp từ các mô hình (FCFE/FCFF/PE/PB/Graham), ưu tiên các mô hình có kết quả hội tụ, loại bỏ outlier rõ ràng
- recommendation: dựa trên upside từ target_price so với giá hiện tại và tín hiệu kỹ thuật
- timing: "Ngay bây giờ" nếu kỹ thuật tích cực và định giá hấp dẫn, "Chờ pullback" nếu ngắn hạn overbought, "Chờ xác nhận" nếu xu hướng không rõ
- pe_assessment/pb_assessment: so sánh TTM với trung bình lịch sử và ngành
- technical.support/resistance: ước từ MA values (null nếu không đủ dữ liệu)
- Toàn bộ bằng tiếng Việt, chuyên nghiệp"""


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
