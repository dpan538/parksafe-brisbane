# ParkSafe Brisbane
**DECO7180 · Design Computing Studio 2 · University of Queensland**  
Team Fourward: Clark Ge · Reshma Jacob · Dai Pan · Leo Tan

Live demo: https://parksafe-brisbane.vercel.app

---

## What this is
ParkSafe Brisbane is an interactive dashboard that helps private vehicle 
owners understand theft risk along their planned route. It draws on 
Queensland Police Service open data, real driving directions, and an 
AI-generated risk summary to make crime patterns visible and actionable 
for everyday parking decisions.

## Tech stack
- Frontend: Vanilla HTML / CSS / ES Modules (no framework, no build step)
- Map: Leaflet.js 1.9 + OpenStreetMap tiles
- Routing: OSRM public API (real driving directions)
- Geocoding: Nominatim (OSM)
- Parking data: Overpass API (OSM amenity=parking)
- Crime data: Queensland Police Service open data (suburb-level, hardcoded)
- AI summary: Google Gemini 2.0 Flash
- Backend: Python Flask (local) / Vercel serverless functions (production)

## Run locally

### Backend (for AI summary)
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY from aistudio.google.com
flask --app app run --port 5000

### Frontend
Open a new terminal tab:
cd parksafe/
python3 -m http.server 8080
# Open http://localhost:8080

Note: without the Flask backend, the AI summary will not work but 
all other features (map, routing, risk zones, parking) will function.

## Use the live version
Open: https://parksafe-brisbane.vercel.app
