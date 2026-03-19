from __future__ import annotations

import os


def project_root() -> str:
    # backend/routes/market -> backend/routes -> backend -> <root>
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def screener_db_path() -> str:
    return os.path.join(project_root(), "fetch_sqlite", "vci_screening.sqlite")
