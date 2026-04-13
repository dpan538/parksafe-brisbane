"""Vercel serverless: POST JSON { "prompt": "..." } -> plain text summary."""

from __future__ import annotations

import json
import os
import warnings
from http.server import BaseHTTPRequestHandler

with warnings.catch_warnings():
    warnings.simplefilter("ignore", category=FutureWarning)
    import google.generativeai as genai


class handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._json(400, {"error": "Invalid JSON body"})
            return

        if not isinstance(body, dict):
            self._json(400, {"error": "Body must be a JSON object"})
            return

        prompt = body.get("prompt", "")
        if not isinstance(prompt, str) or not prompt.strip():
            self._json(400, {"error": 'Body must include non-empty string "prompt"'})
            return

        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get(
            "GOOGLE_API_KEY"
        )
        if not api_key:
            self._json(500, {"error": "GEMINI_API_KEY not set"})
            return

        model_name = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

        try:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel(model_name)
            result = model.generate_content(
                prompt,
                generation_config=genai.GenerationConfig(max_output_tokens=300),
            )
            text = getattr(result, "text", None) or ""
            if not text:
                cands = getattr(result, "candidates", None) or []
                if cands and getattr(cands[0], "content", None):
                    parts = getattr(cands[0].content, "parts", None) or []
                    text = "".join(getattr(p, "text", "") for p in parts)

            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(text.encode("utf-8"))
        except Exception as e:
            msg = str(e)
            low = msg.lower()
            if (
                "429" in msg
                or "quota" in low
                or "resource exhausted" in low
                or "rate limit" in low
            ):
                self._json(429, {"error": msg})
            else:
                self._json(500, {"error": msg})

    def _json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
