# ParkSafe Brisbane — Technical Specification
> DECO7180 · Design Computing Studio 2 · University of Queensland · Team Fourward

---

## 1. Project overview

ParkSafe Brisbane is a browser-based dashboard for private vehicle owners to understand theft risk along a planned route. Users enter origin and destination postcodes (or use the destination search bar), and the app renders driving directions, risk zones, nearby parking markers, and a short AI-generated narrative summary.

The system is intentionally lightweight: no frontend framework, no bundler, and API calls directly from ES modules.

---

## 2. Current architecture

### Frontend
- Static files served from project root (`index.html`, `css/`, `js/`).
- Runs in browser with Leaflet map and OpenStreetMap tiles.
- Core orchestration lives in `js/main.js`.

### Data + external APIs
- **Routing:** OSRM public API (`https://router.project-osrm.org`).
- **Geocoding:** Nominatim (OpenStreetMap).
- **Parking:** Overpass API mirrors (`amenity=parking` query by route bounds).
- **Crime risk:** suburb-level data in `js/data.js` (hardcoded demo set).

### Summary + logging backends
- **Production:** Vercel serverless handlers in `api/summarise.py` and `api/log.py`.
- **Local dev:** Flask server in `backend/app.py`.
- Frontend tries `/api/*` first and falls back to local Flask (`127.0.0.1:5000`) in plain `http` static mode.

---

## 3. Repository structure

```text
parksafe/
├── index.html
├── vercel.json
├── requirements.txt                 # Vercel Python runtime dependencies
├── README.md
├── TECH_SPEC.md
├── api/
│   ├── summarise.py                 # Serverless summary endpoint
│   └── log.py                       # Serverless usage log endpoint (/tmp)
├── backend/
│   ├── app.py                       # Flask local API (/api/summarise, /api/log, /api/crime-data)
│   ├── scraper.py
│   ├── requirements.txt
│   └── data/
│       ├── usage-log.json
│       ├── qps_raw.csv
│       └── DATA_SOURCES.md
├── css/
│   ├── tokens.css
│   ├── reset.css
│   ├── base.css
│   ├── layout.css
│   ├── sidebar.css
│   ├── map.css
│   └── panels.css
├── js/
│   ├── main.js
│   ├── map.js
│   ├── api.js
│   ├── data.js
│   └── llm.js
└── data/
    └── crime-cache.json
```

---

## 4. Frontend module responsibilities

### `js/main.js`
- Binds UI events (`Analyse route`, swap, destination search).
- Coordinates geocoding, routing, risk computation, parking query, AI summary, and usage logging.
- Updates stat cards, footer analytics, risk list, and summary panels.

### `js/map.js`
- Initializes Leaflet map.
- Draws primary route + optional alternative route.
- Manages endpoint markers, risk circles, and parking markers/popups.

### `js/api.js`
- Wraps browser-side HTTP calls:
  - `geocodePostcode`, `reverseGeocode`, `searchPlace` (Nominatim)
  - `fetchRoute` (OSRM)
  - `fetchParkingNearRoute` (Overpass mirrors + `Promise.any`)
- Returns normalized data and graceful `null` on failures.

### `js/data.js`
- Contains demo suburb crime dataset.
- Computes suburbs in route bounds and aggregate risk score.
- Exposes `getPeakRiskPeriod` for sidebar footer details.

### `js/llm.js`
- Builds model prompt from route suburb data.
- Calls summary endpoint with endpoint fallback strategy.
- Streams text into summary panel and post-processes emphasis styling.

---

## 5. API contracts

### `POST /api/summarise`
Request body:
```json
{ "prompt": "string" }
```

Success:
- `200 text/plain` (summary body)

Failure:
- `400 application/json` for invalid input
- `429 application/json` for quota/rate-limit class errors
- `500 application/json` for server/runtime errors

### `GET /api/log`
Returns:
```json
{ "total": 3, "entries": [ ... ] }
```

### `POST /api/log`
Appends one entry and returns:
```json
{ "logged": true, "total": 4 }
```

Notes:
- Vercel serverless log writes to `/tmp/usage-log.json` (ephemeral).
- Flask local log writes to `backend/data/usage-log.json`.

---

## 6. Local development modes

### Mode A: Flask + static server (simple)
1. Start Flask on `:5000` from `backend/`.
2. Start static frontend on `:8080` from project root.
3. Frontend will use `/api/*` when available, otherwise fallback to Flask endpoints.

### Mode B: `vercel dev` (production-like)
1. Run `vercel dev` at project root.
2. Vercel serves static assets and Python handlers together under one origin.

---

## 7. Deployment notes (Vercel)

- `vercel.json` controls routing to static assets and `api/*.py`.
- Set environment variable:
  - `GEMINI_API_KEY` (required), optional `GEMINI_MODEL`.
- If route analysis fails on deployed HTTPS pages, verify OSRM requests use `https://` (mixed-content safe).

---

## 8. Known limitations

- Crime data is currently suburb-level demo data, not real-time events.
- Overpass and OSRM are public free services and may rate-limit or timeout.
- Serverless usage logs are ephemeral in production (`/tmp` storage lifecycle).