from __future__ import annotations

import os


def project_root() -> str:
    # backend/routes/market -> backend/routes -> backend -> <root>
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def screener_db_path() -> str:
    return os.path.join(project_root(), "fetch_sqlite", "vci_screening.sqlite")


def financials_db_path() -> str:
    return os.environ.get(
        "VCI_FINANCIAL_STATEMENT_DB_PATH",
        os.path.join(project_root(), "fetch_sqlite", "vci_financials.sqlite"),
    )


def company_db_path() -> str:
    return os.environ.get(
        "VCI_COMPANY_DB_PATH",
        os.path.join(project_root(), "fetch_sqlite", "vci_company.sqlite"),
    )
