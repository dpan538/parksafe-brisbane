#!/usr/bin/env python3
"""
Fetch Queensland Police Service open crime statistics, filter motor-vehicle
offences for Brisbane-area police divisions, and write data/crime-cache.json.

Run from the backend/ directory:
    python scraper.py
"""

from __future__ import annotations

import csv
import io
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import requests  # pyright: ignore[reportMissingModuleSource]

# Primary CSV: Police Division × Month × offence counts (QPS open data on S3).
# Dataset page: https://www.data.qld.gov.au/dataset/offence-numbers-police-divisions-monthly-from-july-2001
CSV_URL = (
    "https://open-crime-data.s3-ap-southeast-2.amazonaws.com/"
    "Crime%20Statistics/division_Reported_Offences_Number.csv"
)
SOURCE_PAGE = (
    "https://www.data.qld.gov.au/dataset/"
    "offence-numbers-police-divisions-monthly-from-july-2001"
)

BACKEND_DIR = Path(__file__).resolve().parent
ROOT_DIR = BACKEND_DIR.parent
OUT_PATH = ROOT_DIR / "data" / "crime-cache.json"
FALLBACK_CSV = ROOT_DIR / "data" / "qps_raw.csv"

# QPS division names for inner areas that do not contain the substring
# "Brisbane" but sit within Greater Brisbane / City of Brisbane policing.
INNER_BRISBANE_DIVISIONS = frozenset(
    {
        "Fortitude Valley",
        "Indooroopilly",
        "West End",
        "Bowen",  # Bowen Hills / northern inner ring
    }
)


def ensure_dirs() -> None:
    (BACKEND_DIR / "data").mkdir(parents=True, exist_ok=True)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)


def motor_vehicle_columns(fieldnames: list[str]) -> list[str]:
    return [n for n in fieldnames if "motor vehicle" in n.lower()]


def row_matches_brisbane_filter(row: dict) -> bool:
    div = (row.get("Division") or "").strip()
    area = (row.get("Area") or "").strip()
    if "brisbane" in div.lower() or "brisbane" in area.lower():
        return True
    if div in INNER_BRISBANE_DIVISIONS:
        return True
    return False


def parse_csv_text(text: str) -> dict[str, int]:
    """Return suburb (division) name -> total motor-vehicle incident count."""
    f = io.StringIO(text, newline="")
    reader = csv.DictReader(f)
    if not reader.fieldnames:
        raise ValueError("CSV has no header row")

    motor_cols = motor_vehicle_columns(list(reader.fieldnames))
    if not motor_cols:
        raise ValueError("No columns containing 'motor vehicle' in header")

    print(f"  Using offence columns: {motor_cols}")

    counts: dict[str, int] = defaultdict(int)
    rows_kept = 0
    for row in reader:
        if not row_matches_brisbane_filter(row):
            continue
        rows_kept += 1
        div = (row.get("Division") or "").strip()
        if not div:
            continue
        for col in motor_cols:
            raw = (row.get(col) or "").strip() or "0"
            try:
                counts[div] += int(float(raw))
            except ValueError:
                pass

    print(f"  Matched CSV rows (after filters): {rows_kept}")
    print(f"  Aggregated divisions: {len(counts)}")
    return dict(counts)


def load_csv_bytes(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def fetch_or_load_csv() -> str:
    print(f"Downloading CSV…\n  {CSV_URL}")
    try:
        r = requests.get(CSV_URL, timeout=120, headers={"User-Agent": "ParkSafeScraper/1.0"})
        r.raise_for_status()
        if not r.content:
            raise ValueError("Download returned empty body")
        print(f"  HTTP {r.status_code}, {len(r.content)} bytes")
        ensure_dirs()
        FALLBACK_CSV.write_bytes(r.content)
        print(f"  Saved raw copy to {FALLBACK_CSV} (offline fallback)")
        return load_csv_bytes(r.content)
    except (requests.RequestException, OSError, ValueError) as e:
        print(f"  Download failed ({e}); trying fallback file…")
        if FALLBACK_CSV.is_file() and FALLBACK_CSV.stat().st_size > 0:
            print(f"  Reading {FALLBACK_CSV}")
            return FALLBACK_CSV.read_text(encoding="utf-8", errors="replace")
        raise SystemExit(
            "No CSV available (download failed and data/qps_raw.csv missing or empty)."
        ) from e


def build_payload(counts_by_div: dict[str, int]) -> dict:
    if not counts_by_div:
        raise ValueError("No suburbs after filtering — check CSV and filters")

    max_inc = max(counts_by_div.values())
    if max_inc <= 0:
        max_inc = 1

    suburbs: dict[str, dict] = {}
    for name, incidents in sorted(counts_by_div.items(), key=lambda x: (-x[1], x[0])):
        score = min(100, round(100 * incidents / max_inc))
        if score >= 65:
            rank = "high"
        elif score >= 40:
            rank = "medium"
        else:
            rank = "low"
        suburbs[name] = {
            "score": score,
            "incidents": incidents,
            "rank": rank,
            "peak_period": "See QPS data",
        }

    return {
        "updated": date.today().isoformat(),
        "source": "Queensland Police Service open data",
        "source_url": SOURCE_PAGE,
        "suburbs": suburbs,
    }


def main() -> None:
    ensure_dirs()
    print("ParkSafe QPS scraper")
    text = fetch_or_load_csv()
    counts = parse_csv_text(text)
    payload = build_payload(counts)
    OUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {OUT_PATH} ({len(payload['suburbs'])} suburbs)")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        sys.exit(130)
    except SystemExit:
        raise
    except (ValueError, OSError) as e:
        print(f"Scraper failed: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Scraper failed unexpectedly: {e}", file=sys.stderr)
        sys.exit(1)
