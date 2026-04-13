# Cursor Rules — ParkSafe Brisbane

These rules govern how Cursor generates, edits, and reasons about code in this project.
Read TECH_SPEC.md first for full context.

---

## Non-negotiable constraints

- Vanilla HTML/CSS/JS only. No React, no Vue, no npm packages, no build step.
- All JS files use ES module syntax (import/export). index.html loads main.js with type="module".
- Never inline styles in HTML except for Leaflet map container height.
- Never modify tokens.css values — all colours come from CSS custom properties defined there.
- Backend is Python Flask only. Do not suggest FastAPI or Django.
- Never put the Anthropic API key in any frontend file. It lives in .env on the backend only.

---

## CSS rules

- Selectors use BEM-light: .sidebar, .sidebar__label, .sidebar__btn--active
- Use var(--token-name) for every colour, font, and spacing value.
- No drop shadows. No gradients. No border-radius above 4px (buttons: 2px).
- Borders: 1px solid var(--rule) default, 1.5px solid var(--ink) for emphasis.
- Font rules:
  - Headings and data values: font-family: var(--serif), font-weight: 400
  - Labels, tags, buttons, meta: font-family: var(--sans)
  - Do NOT use font-style: italic anywhere in new code

---

## JS rules

- Each module exports named functions only. No default exports.
- All async functions must have try/catch. On error: return null, update #status-bar.
- No jQuery or any DOM library. Use document.querySelector directly.
- Leaflet is global L (CDN script before main.js).
- Functions max 30 lines. One comment per function describing what it returns.

---

## Module responsibilities

| File | Owns | Does NOT own |
|---|---|---|
| map.js | All Leaflet calls | Data fetching, DOM outside map |
| api.js | External HTTP requests | DOM, Leaflet |
| data.js | crime-cache.json + postcodes.json | Network requests |
| llm.js | Prompt + backend fetch | Map, crime parsing |
| main.js | Event wiring, orchestration | Business logic |
| router.js | URL state only | Anything else |

---

## Leaflet specifics

- Risk zones: L.circle, radius 400m, fill opacity 0.12, stroke opacity 0.4
  - High:   fillColor/color '#b84040'
  - Medium: fillColor/color '#c4812a'
  - Low:    fillColor/color '#4a7c5f'
- Parking: L.circleMarker, radius 5, fillColor '#4a7c5f', color '#f7f4ef', weight 1.5
- Route polyline: color '#1c1a17', weight 2, opacity 0.65, dashArray '6 4'
- Call map.invalidateSize() after container becomes visible.

---

## API specifics

- Nominatim User-Agent: 'ParkSafe-Brisbane/1.0 (DECO7180 student project)'
- Nominatim: 1100ms delay between origin and destination calls.
- Overpass template:
  [out:json][timeout:10];
  node["amenity"="parking"](south,west,north,east);
  out body;

---

## Flask backend

- Single file app.py, one route: POST /api/summarise
- Request: { "prompt": string }   Response: streaming text/plain
- CORS: Access-Control-Allow-Origin: http://localhost:8080
- Model: claude-haiku-4-5-20251001, max_tokens: 300
- Do not log prompts to console.

---

## One change at a time

- Make exactly the requested change.
- Do not refactor surrounding code.
- Do not rename existing variables or selectors.
- State which files changed and what was modified.