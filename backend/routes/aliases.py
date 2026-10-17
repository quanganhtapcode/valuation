"""Resource-oriented public routes; old URLs remain compatible aliases.

Register once, after the blueprints. Reusing the exact view and methods keeps
validation, rate limits and response schemas identical without HTTP redirects.
"""

import json
from pathlib import Path

from flask import Flask


API_ALIASES = json.loads(
    (Path(__file__).resolve().parents[2] / "frontend-next/src/lib/apiRouteAliases.json").read_text(encoding="utf-8")
)


def register_api_aliases(app: Flask) -> None:
    rules = {rule.rule: rule for rule in app.url_map.iter_rules()}
    for index, (canonical, legacy) in enumerate(API_ALIASES.items()):
        original = rules[legacy]
        app.add_url_rule(
            canonical,
            endpoint=f"canonical_api_{index}",
            view_func=app.view_functions[original.endpoint],
            methods=original.methods - {"HEAD", "OPTIONS"},
        )
