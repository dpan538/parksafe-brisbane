"""Vercel serverless: usage log, parking reviews save/load (path-based routing)."""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
from log_schema import canonical_usage_log_row  # noqa: E402

LOG_PATH = "/tmp/usage-log.json"
REVIEWS_PATH = "/tmp/parking-reviews.json"


class handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Access-Control-Allow-Methods",
            "GET, POST, OPTIONS",
        )
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0].rstrip("/")
        if path.endswith("/api/reviews"):
            self._handle_get_reviews()
            return
        try:
            entries = _read_entries()
            self._json(
                200,
                {"total": len(entries), "entries": entries},
            )
        except Exception as e:
            self._json(500, {"error": str(e)})

    def do_POST(self):
        path = self.path.split("?", 1)[0].rstrip("/")
        if path.endswith("/api/review"):
            self._handle_post_review()
            return

        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = {}

        if not isinstance(data, dict):
            data = {}

        if path.endswith("/api/log/update"):
            self._handle_log_update(data)
            return

        entry = canonical_usage_log_row(data)

        try:
            entries = _read_entries()
            entries.append(entry)
            with open(LOG_PATH, "w", encoding="utf-8") as f:
                f.write(json.dumps(entries, indent=2, ensure_ascii=False) + "\n")
            self._json(
                200,
                {"logged": True, "total": len(entries)},
            )
        except Exception as e:
            self._json(500, {"logged": False, "error": str(e)})

    def _handle_log_update(self, data: dict) -> None:
        sid = data.get("session_id")
        if not sid:
            self._json(400, {"updated": False, "error": "session_id required"})
            return
        try:
            entries = _read_entries()
            idx = None
            for i in range(len(entries) - 1, -1, -1):
                if isinstance(entries[i], dict) and entries[i].get("session_id") == sid:
                    idx = i
                    break
            if idx is None:
                self._json(404, {"updated": False, "error": "session not found"})
                return
            row = entries[idx]
            for k in ("proceeded", "used_alternative", "clicked_parking"):
                if k in data:
                    row[k] = data[k]
            entries[idx] = canonical_usage_log_row(row)
            with open(LOG_PATH, "w", encoding="utf-8") as f:
                f.write(json.dumps(entries, indent=2, ensure_ascii=False) + "\n")
            self._json(200, {"updated": True, "session_id": sid})
        except Exception as e:
            self._json(500, {"updated": False, "error": str(e)})

    def _handle_get_reviews(self):
        try:
            if os.path.isfile(REVIEWS_PATH):
                raw = open(REVIEWS_PATH, encoding="utf-8").read().strip()
                data = json.loads(raw) if raw else {"reviews": {}}
            else:
                data = {"reviews": {}}
            if not isinstance(data, dict):
                data = {"reviews": {}}
            if "reviews" not in data or not isinstance(data["reviews"], dict):
                data["reviews"] = {}
            self._json(200, data)
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _handle_post_review(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = {}
        if not isinstance(data, dict):
            data = {}

        try:
            if os.path.isfile(REVIEWS_PATH):
                raw = open(REVIEWS_PATH, encoding="utf-8").read().strip()
                store = json.loads(raw) if raw else {"reviews": {}}
            else:
                store = {"reviews": {}}

            if "reviews" not in store or not isinstance(store["reviews"], dict):
                store["reviews"] = {}

            key = data.get("park_key", "default")

            if key not in store["reviews"]:
                store["reviews"][key] = {
                    "name": data.get("name", "Car park"),
                    "ratings": [],
                    "comments": [],
                }

            if data.get("rating"):
                store["reviews"][key]["ratings"].append(data["rating"])

            if data.get("comment"):
                store["reviews"][key]["comments"].insert(
                    0,
                    {
                        "text": data["comment"],
                        "time": data.get("time_of_day", "Unknown"),
                        "date": data.get("date", ""),
                    },
                )

            with open(REVIEWS_PATH, "w", encoding="utf-8") as f:
                f.write(json.dumps(store, indent=2, ensure_ascii=False) + "\n")
            self._json(200, {"saved": True})
        except Exception as e:
            self._json(500, {"saved": False, "error": str(e)})

    def _json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


def _read_entries():
    if not os.path.isfile(LOG_PATH):
        return []
    try:
        raw = open(LOG_PATH, encoding="utf-8").read().strip()
        if not raw:
            return []
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError, TypeError):
        return []
