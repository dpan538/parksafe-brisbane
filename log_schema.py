"""
Canonical shape for usage-log.json rows (Flask + Vercel serverless).
Every stored object includes the same keys in a stable order.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

LOG_ENTRY_ORDER = (
    "session_id",
    "timestamp",
    "weekday",
    "time_of_day",
    "is_weekend",
    "origin",
    "destination",
    "input_method",
    "risk_score",
    "risk_rank",
    "suburb_count",
    "high_risk_count",
    "risk_ratio",
    "parking_found",
    "route_km",
    "time_to_analyse_sec",
    "proceeded",
    "used_alternative",
    "clicked_parking",
)

LOG_ENTRY_KEYS = frozenset(LOG_ENTRY_ORDER)

_DEFAULTS: dict[str, Any] = {
    "session_id": "",
    "timestamp": "",
    "weekday": "",
    "time_of_day": "",
    "is_weekend": False,
    "origin": "",
    "destination": "",
    "input_method": "manual",
    "risk_score": 0,
    "risk_rank": "",
    "suburb_count": 0,
    "high_risk_count": 0,
    "risk_ratio": 0.0,
    "parking_found": 0,
    "route_km": 0.0,
    "time_to_analyse_sec": 0.0,
    "proceeded": None,
    "used_alternative": False,
    "clicked_parking": False,
}


def _weekday_from_timestamp(ts: object) -> str:
    if not ts:
        return ""
    s = str(ts).strip()
    if not s:
        return ""
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        d = datetime.fromisoformat(s)
        return d.strftime("%A")
    except (ValueError, TypeError, OSError):
        return ""


def canonical_usage_log_row(data: object) -> dict[str, Any]:
    """Merge client payload with defaults; always return LOG_ENTRY_ORDER keys."""
    if not isinstance(data, dict):
        data = {}
    overlay = {k: data[k] for k in LOG_ENTRY_KEYS if k in data}
    merged: dict[str, Any] = {**_DEFAULTS, **overlay}
    if not str(merged.get("weekday") or "").strip() and merged.get("timestamp"):
        wd = _weekday_from_timestamp(merged["timestamp"])
        if wd:
            merged["weekday"] = wd
    if not merged.get("timestamp"):
        merged["timestamp"] = datetime.now().isoformat()
    return {k: merged.get(k, _DEFAULTS[k]) for k in LOG_ENTRY_ORDER}
