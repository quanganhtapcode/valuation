from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Any


def parse_lottery_rss(*, content: bytes, region: str) -> dict[str, Any]:
    root = ET.fromstring(content)
    item = root.find("./channel/item")
    if item is None:
        return {"title": "", "pubDate": "", "results": {}}

    title = (item.find("title").text if item.find("title") is not None else "") or ""
    description = (item.find("description").text if item.find("description") is not None else "") or ""
    date_str = (item.find("pubDate").text if item.find("pubDate") is not None else "") or ""

    description = description.replace("\n", " ").replace("\r", " ").strip()
    results: dict[str, Any] = {}

    if region == "mb":
        prizes = {
            "DB": r"DB:\s*([\d]+)",
            "G1": r"G\.1:\s*([\d]+)",
            "G2": r"G\.2:\s*([\d\s\-]+?)(?=G\.3|$)",
            "G3": r"G\.3:\s*([\d\s\-]+?)(?=G\.4|$)",
            "G4": r"G\.4:\s*([\d\s\-]+?)(?=G\.5|$)",
            "G5": r"G\.5:\s*([\d\s\-]+?)(?=G\.6|$)",
            "G6": r"G\.6:\s*([\d\s\-]+?)(?=G\.7|$)",
            "G7": r"G\.7:\s*([\d\s\-]+)",
        }

        for key, pattern in prizes.items():
            m = re.search(pattern, description)
            if not m:
                continue
            val = m.group(1).strip().replace(" - ", ", ").split(", ")
            results[key] = [v.strip() for v in val]
    else:
        parts = re.split(r"\[([^\]]+)\]", description)
        provinces_data = []
        if len(parts) > 1:
            idx = 1
            while idx < len(parts):
                p_name = parts[idx].strip()
                p_data = parts[idx + 1] if idx + 1 < len(parts) else ""

                p_res: dict[str, Any] = {}
                prizes_ptr = {
                    "G8": r"G\.8:\s*([\d]+)",
                    "G7": r"G\.7:\s*([\d]+)",
                    "G6": r"G\.6:\s*([\d\s\-]+?)(?=G\.5|$)",
                    "G5": r"G\.5:\s*([\d]+)",
                    "G4": r"G\.4:\s*([\d\s\-]+?)(?=G\.3|$)",
                    "G3": r"G\.3:\s*([\d\s\-]+?)(?=G\.2|$)",
                    "G2": r"G\.2:\s*([\d]+)",
                    "G1": r"G\.1:\s*([\d]+)",
                    "DB": r"(?:DB|ĐB|DB6):\s*([\d]+)",
                }

                for key, pattern in prizes_ptr.items():
                    m = re.search(pattern, p_data)
                    if not m:
                        continue
                    val = m.group(1).strip().replace(" - ", ", ").split(", ")
                    p_res[key] = [v.strip() for v in val]

                if p_res:
                    provinces_data.append({"name": p_name, "prizes": p_res})

                idx += 2

        results = {"provinces": provinces_data}

    return {"title": title, "pubDate": date_str, "results": results}
