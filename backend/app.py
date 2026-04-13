import json
import os
import warnings
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request, stream_with_context

# google-generativeai emits a package deprecation FutureWarning on import
with warnings.catch_warnings():
    warnings.simplefilter("ignore", category=FutureWarning)
    import google.generativeai as genai

load_dotenv()

app = Flask(__name__)

BACKEND_DIR = Path(__file__).resolve().parent
ROOT_DIR = BACKEND_DIR.parent
CRIME_CACHE_PATH = ROOT_DIR / "data" / "crime-cache.json"
LOG_PATH = BACKEND_DIR / "data" / "usage-log.json"
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite")


def _api_key() -> str | None:
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    return resp


def preflight():
    resp = Response("", 200)
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


def _read_log():
    if not LOG_PATH.is_file():
        return []
    try:
        raw = LOG_PATH.read_text(encoding="utf-8").strip()
        if not raw:
            return []
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError, TypeError):
        return []


def _ensure_log_dir():
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)


@app.route("/api/health", methods=["GET", "OPTIONS"])
def health():
    if request.method == "OPTIONS":
        return preflight()
    return cors(jsonify({"status": "ok"}))


@app.route("/api/crime-data", methods=["GET", "OPTIONS"])
def crime_data():
    if request.method == "OPTIONS":
        return preflight()
    if not CRIME_CACHE_PATH.is_file():
        r = jsonify(
            error="crime-cache.json not found. Run python scraper.py from backend/ directory.",
        )
        r.status_code = 404
        return cors(r)
    try:
        payload = json.loads(CRIME_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        r = jsonify(error=str(e))
        r.status_code = 500
        return cors(r)
    return cors(jsonify(payload))


@app.route("/api/summarise", methods=["POST", "OPTIONS"])
def summarise():
    if request.method == "OPTIONS":
        return preflight()

    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get("prompt"), str):
        return cors(jsonify(error='Body must be {"prompt": string}')), 400

    api_key = _api_key()
    if not api_key:
        return cors(
            jsonify(
                error="GEMINI_API_KEY (or GOOGLE_API_KEY) not configured in .env",
            ),
        ), 500

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(GEMINI_MODEL)
    generation_config = genai.GenerationConfig(max_output_tokens=300)

    try:
        stream = model.generate_content(
            data["prompt"],
            stream=True,
            generation_config=generation_config,
        )
    except Exception as e:
        msg = str(e)
        low = msg.lower()
        r = jsonify(error=msg)
        if (
            "429" in msg
            or "quota" in low
            or "resource exhausted" in low
            or "rate limit" in low
        ):
            r.status_code = 429
        else:
            r.status_code = 500
        return cors(r)

    def chunks():
        for chunk in stream:
            if chunk.text:
                yield chunk.text

    resp = Response(stream_with_context(chunks()), mimetype="text/plain")
    return cors(resp)


@app.route("/api/log", methods=["GET", "POST", "OPTIONS"])
def log():
    if request.method == "OPTIONS":
        return preflight()
    if request.method == "GET":
        try:
            entries = _read_log()
            return cors(jsonify({"total": len(entries), "entries": entries}))
        except Exception as e:
            return cors(jsonify({"error": str(e)})), 500

    # POST
    data = request.get_json(silent=True) or {}
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
        _ensure_log_dir()
        entries = _read_log()
        entries.append(entry)
        LOG_PATH.write_text(
            json.dumps(entries, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return cors(jsonify({"logged": True, "total": len(entries)}))
    except Exception as e:
        return cors(jsonify({"logged": False, "error": str(e)})), 500
