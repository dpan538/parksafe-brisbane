# ParkSafe Brisbane — Technical Specification
> DECO7180 · Team Fourward · Author: Dai Pan

---

## 1. Project overview

ParkSafe is a browser-based dashboard that helps Brisbane vehicle owners assess theft risk along a planned route. The user inputs an origin and destination postcode; the app geocodes both, draws the route on an interactive map, overlays crime hotspot zones fetched from Queensland Police Service open data, identifies parking areas along the corridor via OpenStreetMap, and generates a plain-language risk summary via a language model API.

**Design language:** Editorial warmth — warm paper tones, serif headings, ink-dark rules, no drop shadows. Optimised for a 13-inch MacBook display (1440 × 900 logical pixels).

---

## 2. Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Structure | Vanilla HTML5 | No build step, fully auditable |
| Styling | Vanilla CSS (modular files) | Direct control, no framework overhead |
| Map | Leaflet.js 1.9 via CDN | Free, lightweight, OSM compatible |
| Geocoding | Nominatim (OSM) | Free, no API key required |
| Parking data | Overpass API (OSM) | Free, queries amenity=parking by bbox |
| Crime data | QLD open data CSV (cached JSON) | data.qld.gov.au, refreshed weekly |
| LLM | Anthropic Claude API (via backend proxy) | Risk narrative generation |
| Backend | Python + Flask (minimal) | Proxy for API key safety + CSV scraper |
| Hosting (dev) | Python http.server or VS Code Live Server | Zero config |

No npm. No build tools. No React. All JS is ES modules loaded via script type="module".

---

## 3. File structure

```
parksafe/
├── index.html              # Single page entry point
├── css/
│   ├── tokens.css          # Design tokens (colours, type, spacing)
│   ├── reset.css           # Minimal CSS reset
│   ├── base.css            # Body, typography, global elements
│   ├── layout.css          # Dashboard grid (topbar / sidebar / main)
│   ├── sidebar.css         # Route planner + stat cells
│   ├── map.css             # Map container, legend, controls
│   └── panels.css          # Bottom panels (summary, zones, risk index)
├── js/
│   ├── main.js             # App init, event wiring
│   ├── map.js              # Leaflet init, route drawing, marker management
│   ├── api.js              # Nominatim geocoding + Overpass parking query
│   ├── data.js             # Crime data loader + postcode lookup
│   ├── llm.js              # LLM prompt builder + fetch to backend proxy
│   └── router.js           # URL state (postcode in query string)
├── data/
│   ├── postcodes.json      # Brisbane postcode → suburb name + centroid
│   └── crime-cache.json    # Pre-processed QPS crime data by suburb
├── assets/
│   └── icons/              # Inline SVG icons if needed
├── .env.example            # ANTHROPIC_API_KEY=your_key_here
├── TECH_SPEC.md
├── CURSOR_RULES.md
└── README.md
```

---

## 4. CSS architecture

All CSS is imported in order via link tags in index.html. No CSS-in-JS, no scoped styles.

### 4.1 Design tokens (tokens.css)

```css
:root {
  --paper:    #f7f4ef;
  --paper-2:  #f0ebe2;
  --paper-3:  #e8e1d5;
  --ink:      #1c1a17;
  --ink-2:    #5c564d;
  --ink-3:    #9b9289;
  --rule:     #d6cfc4;
  --accent:   #c96a2b;
  --danger:   #b84040;
  --warn:     #c4812a;
  --safe:     #4a7c5f;
  --serif:    Georgia, 'Times New Roman', serif;
  --sans:     system-ui, -apple-system, sans-serif;
  --sidebar-w: 268px;
  --topbar-h:  48px;
  --panels-h:  196px;
}
```

### 4.2 Layout grid (layout.css)

```css
.dashboard {
  display: grid;
  grid-template-columns: var(--sidebar-w) 1fr;
  grid-template-rows: var(--topbar-h) 1fr;
  height: 100vh;
  max-height: 900px;
}
```

The dashboard never scrolls. All content fits in the viewport.

---

## 5. JavaScript modules

### main.js
Imports all modules. Binds #analyse-btn click → orchestrates geocode → route → parking → crime → llm. Manages loading states.

### map.js
- Initialises Leaflet centred on Brisbane (-27.47, 153.02, zoom 12)
- Tile: https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
- Exports: drawRoute(A, B), addParkingMarkers(features), addRiskZones(zones), clearAll()

### api.js
- geocodePostcode(postcode) → Nominatim → {lat, lng, display_name}
- fetchParkingNearRoute(bounds) → Overpass API → parking features
- Both async, return null on failure

### data.js
- Loads crime-cache.json once on startup
- getCrimeScore(suburb) → {score, incidents, rank}
- getSuburbsAlongRoute(A, B) → suburb list from bbox check

### llm.js
- buildPrompt(origin, destination, zones) → string
- fetchRiskSummary(prompt) → POST /api/summarise → streams into #ai-summary-text

### router.js
- Reads ?from=4000&to=4067 on load, pre-fills inputs
- Updates URL on analyse via history.pushState

---

## 6. Backend (Flask proxy)

```
backend/
├── app.py           # POST /api/summarise → Anthropic API → stream
├── scraper.py       # Fetches QPS CSV → outputs crime-cache.json
└── requirements.txt # flask, anthropic, requests
```

Model: claude-haiku-4-5 (fast, cheap for short summaries ~$0.001 each).
CORS restricted to localhost in dev.

---

## 7. Data flow

```
User clicks "Analyse route"
  ├─► geocodePostcode(origin + dest)   → Nominatim
  ├─► drawRoute(A, B)                  → Leaflet polyline
  ├─► getSuburbsAlongRoute(A, B)       → data.js
  ├─► getCrimeScore(each suburb)       → data.js → risk zones
  ├─► addRiskZones(zones)              → map.js
  ├─► fetchParkingNearRoute(bbox)      → Overpass
  ├─► addParkingMarkers(features)      → map.js
  └─► buildPrompt + fetchRiskSummary   → Flask → Claude → streamed text
```

---

## 8. crime-cache.json schema

```json
{
  "updated": "2025-04-01",
  "source": "Queensland Police Service open data",
  "suburbs": {
    "Milton": {
      "score": 78,
      "incidents_per_100k": 142.3,
      "rank": "high",
      "peak_period": "Fri-Sat 20:00-02:00"
    }
  }
}
```

---

## 9. LLM prompt template

```
You are a crime risk analyst for a vehicle theft awareness tool in Brisbane.
The user is driving from {origin} to {destination}.
Route suburbs and risk profiles: {zones_list}

Write 2-3 sentences of plain-language summary. Include:
- Overall route risk level
- Highest-risk area and brief reason
- One practical recommendation

No bullet points. Calm, factual prose.
```

---

## 10. External API limits

| API | Rate limit | Key | Cost |
|---|---|---|---|
| Nominatim | 1 req/sec | No | Free |
| Overpass | Fair use | No | Free |
| OSM tiles | Fair use | No | Free |
| Anthropic | Per token | Backend only | ~$0.001/summary |
| QPS open data | None | No | Free |

---

## 11. Out of scope (demo)

- No user accounts
- No mobile layout (desktop-only)
- No turn-by-turn routing (straight polyline for demo)
- No real-time crime events (weekly cache)