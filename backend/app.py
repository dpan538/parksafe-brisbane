import json
import os
import sys
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
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
from log_schema import canonical_usage_log_row  # noqa: E402

CRIME_CACHE_PATH = ROOT_DIR / "data" / "crime-cache.json"
LOG_PATH = Path(__file__).resolve().parent.parent / "data" / "usage-log.json"
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


@app.route("/api/review", methods=["POST", "OPTIONS"])
def save_review():
    if request.method == "OPTIONS":
        return preflight()

    data = request.get_json(silent=True) or {}

    reviews_path = ROOT_DIR / "data" / "parking-reviews.json"

    try:
        if reviews_path.exists():
            store = json.loads(reviews_path.read_text(encoding="utf-8"))
        else:
            store = {"reviews": {}}

        if "reviews" not in store or not isinstance(store["reviews"], dict):
            store["reviews"] = {}

        key = str(data.get("park_key") or "default").strip() or "default"

        if key not in store["reviews"]:
            store["reviews"][key] = {
                "name": data.get("name", "Car park"),
                "ratings": [],
                "comments": [],
            }

        if data.get("rating") is not None:
            try:
                store["reviews"][key]["ratings"].append(int(data["rating"]))
            except (TypeError, ValueError):
                pass

        if data.get("comment"):
            rating_val = data.get("rating")
            try:
                rating_int = int(rating_val) if rating_val is not None else None
            except (TypeError, ValueError):
                rating_int = None
            comment_row = {
                "park_key": key,
                "rating": rating_int,
                "comment": data["comment"],
                "time_of_day": data.get("time_of_day", "Unknown"),
                "date": data.get("date", ""),
                "session_origin": data.get("session_origin", ""),
                "session_dest": data.get("session_dest", ""),
                "text": data["comment"],
                "time": data.get("time_of_day", "Unknown"),
            }
            store["reviews"][key]["comments"].insert(0, comment_row)

        reviews_path.parent.mkdir(parents=True, exist_ok=True)
        reviews_path.write_text(
            json.dumps(store, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"Review written to key: {key}")
        return cors(jsonify({"saved": True}))

    except Exception as e:
        return cors(jsonify({"saved": False, "error": str(e)})), 500


@app.route("/api/reviews", methods=["GET", "OPTIONS"])
def get_reviews():
    if request.method == "OPTIONS":
        return preflight()
    reviews_path = ROOT_DIR / "data" / "parking-reviews.json"
    try:
        if reviews_path.exists():
            data = json.loads(reviews_path.read_text(encoding="utf-8"))
        else:
            data = {"reviews": {}}
        return cors(jsonify(data))
    except Exception as e:
        return cors(jsonify({"error": str(e)})), 500


@app.route("/api/log/update", methods=["POST", "OPTIONS"])
def log_update():
    if request.method == "OPTIONS":
        return preflight()
    data = request.get_json(silent=True) or {}
    sid = data.get("session_id")
    if not sid:
        r = jsonify({"updated": False, "error": "session_id required"})
        r.status_code = 400
        return cors(r)
    try:
        _ensure_log_dir()
        entries = _read_log()
        idx = None
        for i in range(len(entries) - 1, -1, -1):
            if isinstance(entries[i], dict) and entries[i].get("session_id") == sid:
                idx = i
                break
        if idx is None:
            r = jsonify({"updated": False, "error": "session not found"})
            r.status_code = 404
            return cors(r)
        row = entries[idx]
        patch = {}
        for k in ("proceeded", "used_alternative", "clicked_parking"):
            if k in data:
                row[k] = data[k]
                patch[k] = data[k]
        entries[idx] = canonical_usage_log_row(row)
        LOG_PATH.write_text(
            json.dumps(entries, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"Log updated session={sid} patch={patch}")
        return cors(jsonify({"updated": True, "session_id": sid}))
    except Exception as e:
        return cors(jsonify({"updated": False, "error": str(e)})), 500


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

    # POST — persist full client payload (whitelist keys) for each Analyse Route
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        data = {}
    entry = canonical_usage_log_row(data)
    try:
        _ensure_log_dir()
        entries = _read_log()
        entries.append(entry)
        LOG_PATH.write_text(
            json.dumps(entries, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"Log written: {entry}")
        return cors(jsonify({"logged": True, "total": len(entries)}))
    except Exception as e:
        return cors(jsonify({"logged": False, "error": str(e)})), 500
