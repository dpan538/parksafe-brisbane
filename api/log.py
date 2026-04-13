"""Vercel serverless: usage log in /tmp (ephemeral). GET returns JSON; POST appends."""

from __future__ import annotations

import json
import os
from datetime import datetime
from http.server import BaseHTTPRequestHandler

LOG_PATH = "/tmp/usage-log.json"


class handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        try:
            entries = _read_entries()
            self._json(
                200,
                {"total": len(entries), "entries": entries},
            )
        except Exception as e:
            self._json(500, {"error": str(e)})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            data = {}

        if not isinstance(data, dict):
            data = {}

        entry = {
            "timestamp": datetime.now().isoformat(),
            "origin": data.get("origin", ""),
            "destination": data.get("destination", ""),
            "risk_score": data.get("risk_score", 0),
            "risk_rank": data.get("risk_rank", ""),
            "suburb_count": data.get("suburb_count", 0),
            "parking_found": data.get("parking_found", 0),
        }

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
