from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

# Fallback chain: try models in order until one succeeds.
#
# AI_PROVIDER_ORDER controls provider order:
#   gemma,openrouter  -> current behavior, OpenRouter as fallback
#   openrouter,gemma  -> prefer OpenRouter free models, then Gemma
_MODEL_CHAIN = [
    m.strip()
    for m in os.environ.get("GEMMA_MODEL_CHAIN", "gemma-4-31b-it,gemma-4-26b-a4b-it").split(",")
    if m.strip()
]
_OPENROUTER_MODEL_CHAIN = [
    m.strip()
    for m in os.environ.get(
        "OPENROUTER_MODEL_CHAIN",
        os.environ.get(
            "OPENROUTER_MODEL",
            "openrouter/free,google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free,openai/gpt-oss-120b:free",
        ),
    ).split(",")
    if m.strip()
]
_PROVIDER_ORDER = [
    p.strip().lower()
    for p in os.environ.get("AI_PROVIDER_ORDER", "openrouter,gemma").split(",")
    if p.strip()
]
_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_OPENROUTER_API_BASE = "https://openrouter.ai/api/v1/chat/completions"
_TIMEOUT = 90
_QUOTA_EXCEEDED = {429}   # permanently skip model this run
_TRANSIENT_ERRORS = {500, 502, 503}  # retry with backoff before moving to next model


def _api_key() -> str:
    key = os.environ.get("GEMMA_API_KEY", "")
    if not key:
        raise RuntimeError("GEMMA_API_KEY not set")
    return key


def _openrouter_api_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY not set")
    return key


def _call_gemma_model(model: str, prompt: str) -> str:
    url = f"{_GEMINI_API_BASE}/{model}:generateContent?key={_api_key()}"
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 1800, "temperature": 0.3},
    }).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
        data: Any = json.loads(resp.read())
    parts = data["candidates"][0]["content"]["parts"]
    texts = [p["text"] for p in parts if not p.get("thought")]
    return "\n".join(texts).strip()


def _call_openrouter_model(model: str, prompt: str) -> str:
    headers = {
        "Authorization": f"Bearer {_openrouter_api_key()}",
        "Content-Type": "application/json",
        "HTTP-Referer": os.environ.get("OPENROUTER_SITE_URL", "https://stock.quanganh.org"),
        "X-Title": os.environ.get("OPENROUTER_APP_NAME", "Vietnam Stock Valuation"),
    }
    body = json.dumps({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "Bạn là chuyên gia phân tích chứng khoán Việt Nam. Chỉ trả về JSON hợp lệ khi được yêu cầu.",
            },
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 1800,
        "temperature": 0.3,
    }).encode()
    req = urllib.request.Request(_OPENROUTER_API_BASE, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
        data: Any = json.loads(resp.read())
    content = data["choices"][0].get("message", {}).get("content")
    if not content:
        model_used = data.get("model") or model
        raise RuntimeError(f"OpenRouter returned empty content for {model_used}")
    return content.strip()


_quota_exceeded_models: set[str] = set()  # 429 = skip for entire run


_TRANSIENT_BACKOFF = [10, 30]  # seconds to wait before attempt 2 and 3 per model


def _provider_models(provider: str) -> list[str]:
    if provider == "gemma":
        return _MODEL_CHAIN
    if provider == "openrouter":
        return _OPENROUTER_MODEL_CHAIN if os.environ.get("OPENROUTER_API_KEY") else []
    return []


def _call_provider_model(provider: str, model: str, prompt: str) -> str:
    if provider == "gemma":
        return _call_gemma_model(model, prompt)
    if provider == "openrouter":
        return _call_openrouter_model(model, prompt)
    raise RuntimeError(f"Unknown AI provider: {provider}")


def generate(prompt: str) -> tuple[str, str]:
    """Try each model in the fallback chain. Returns (response_text, model_used).

    - 429: model is quota-exhausted, skip for the rest of this run.
    - 500/502/503: transient, retry up to 2 times with 10s/30s backoff per model.
    """
    import time
    last_err: Exception | None = None

    for provider in _PROVIDER_ORDER:
        for model in _provider_models(provider):
            model_key = f"{provider}:{model}"
            if model_key in _quota_exceeded_models:
                continue
            for attempt in range(3):  # up to 3 attempts per model
                try:
                    result = _call_provider_model(provider, model, prompt)
                    if provider != _PROVIDER_ORDER[0] or model != _provider_models(provider)[0]:
                        logger.info(f"Used fallback AI model: {model_key}")
                    return result, model_key
                except urllib.error.HTTPError as e:
                    if e.code in _QUOTA_EXCEEDED:
                        logger.warning(f"Model {model_key} quota exceeded (429), skipping for this run")
                        _quota_exceeded_models.add(model_key)
                        break
                    if e.code in _TRANSIENT_ERRORS and attempt < 2:
                        wait = _TRANSIENT_BACKOFF[attempt]
                        logger.warning(f"Model {model_key} HTTP {e.code} (attempt {attempt+1}), retrying in {wait}s")
                        time.sleep(wait)
                        last_err = e
                        continue
                    last_err = e
                    break
                except Exception as e:
                    last_err = e
                    break

    raise RuntimeError(f"All models exhausted. Last error: {last_err}")


def generate_openrouter(prompt: str) -> tuple[str, str]:
    """Generate with OpenRouter models only. Returns (response_text, model_used)."""
    last_err: Exception | None = None
    models = _provider_models("openrouter")
    if not models:
        raise RuntimeError("OPENROUTER_API_KEY not set")

    for model in models:
        model_key = f"openrouter:{model}"
        try:
            return _call_openrouter_model(model, prompt), model_key
        except Exception as e:
            last_err = e
            logger.warning("OpenRouter model %s failed: %s", model_key, e)

    raise RuntimeError(f"All OpenRouter models exhausted. Last error: {last_err}")
