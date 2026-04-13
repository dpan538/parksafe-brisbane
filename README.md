# ParkSafe Brisbane

**DECO7180 · Design Computing Studio 2 · Team Fourward**

**Members:** Clark Ge, Reshma Jacob, Dai Pan, Leo Tan

---

## What this is

ParkSafe Brisbane is an interactive **vehicle theft risk dashboard** for Greater Brisbane. Drivers enter a route (by postcode or top-bar search), and the app plots the journey on a **Leaflet** map with risk zones derived from **Queensland Police Service (QPS) open data**, suggests safer routing and parking context where available, and streams a short **AI-generated safety summary** for the corridor. It is a student studio project for exploration and guidance only—not operational safety or policing advice.

---

## Prerequisites

- **Python 3.9+**
- A **modern browser** (Chrome recommended)
- A **Gemini API key** (free tier: [Google AI Studio](https://aistudio.google.com))

---

## Setup — step by step

### 1. Get the project

Unzip the project folder (or clone it), open **Terminal**, and go to the project root:

```bash
cd parksafe
```

(Use your actual folder name if it differs.)

### 2. Set up the backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Configure API key

If the repo includes `backend/.env.example`, copy it:

```bash
cp .env.example .env
```

Otherwise, create **`backend/.env`** yourself. Open it in any text editor and set your key (replace the placeholder with your real value):

```env
GEMINI_API_KEY=your_key_here
```

You may use **`GOOGLE_API_KEY`** instead; the backend accepts either. Optionally set **`GEMINI_MODEL`** (see `backend/app.py` for the default model name).

### 4. Start the backend

Stay in **`backend/`** with the virtualenv **activated**:

```bash
flask --app app run --port 5000
```

The API listens on **http://127.0.0.1:5000** (and typically **http://localhost:5000**).

### 5. Start the frontend

Open a **new** terminal tab or window, go to the **project root** (the folder that contains `index.html`), and serve static files:

```bash
cd parksafe
python3 -m http.server 8080
```

### 6. Open the app

In your browser, open **http://localhost:8080**.

> The frontend expects the backend on port **5000**. Use **localhost** (not only IPv6 `[::]`) if geolocation or CORS behaviour is flaky.

---

## How to use

- Enter **origin** and **destination** Australian postcodes in the sidebar, then click **Analyse route**.
- Or type a **destination** in the **top search bar** (the app uses your **GPS** for the origin when permitted).
- Explore **risk zones**, **safe parking** markers, optional **alternative route**, and the **AI summary** in the panels.

---

## Usage logs

Each completed analysis appends an entry to **`backend/data/usage-log.json`** automatically.

To inspect logs:

- Open **`backend/data/usage-log.json`** in your editor, or  
- Visit **http://localhost:5000/api/log** while the Flask server is running.

---

## Data sources

See **`backend/data/DATA_SOURCES.md`** for the full list of datasets, attributions, and licences.

---

## Tech stack

- **Frontend:** Vanilla HTML, CSS, and **ES modules** (no bundler)
- **Map:** **Leaflet.js 1.9** + **OpenStreetMap** tiles
- **Routing:** **OSRM** public demo API
- **Geocoding / search:** **Nominatim**; parking queries via **Overpass**
- **Crime data:** **QPS** open data (currently reflected in frontend hardcoding; **`backend/scraper.py`** is intended to refresh **`data/crime-cache.json`**)
- **AI summary:** **Google Gemini** via Flask proxy (`/api/summarise`)
- **Backend:** **Python Flask**

---

## Project structure

Typical layout (excluding **`venv/`**, **`__pycache__/`**, **`.DS_Store`**, and local secrets such as **`.env`**):

```
./CURSOR_RULES.md
./README.md
./TECH_SPEC.md
./backend/app.py
./backend/data/DATA_SOURCES.md
./backend/data/qps_raw.csv
./backend/data/usage-log.json
./backend/requirements.txt
./backend/scraper.py
./data/crime-cache.json
./css/base.css
./css/layout.css
./css/map.css
./css/panels.css
./css/reset.css
./css/sidebar.css
./css/tokens.css
./index.html
./js/api.js
./js/data.js
./js/llm.js
./js/main.js
./js/map.js
```

Run `find . -type f` from the project root and filter out `venv`, `__pycache__`, and `.DS_Store` if you need an exact listing on your machine.

---

## Note for team members

- **Do not** commit **`backend/.env`** (or any file containing real API keys) to a shared repository.
- **Do not** share your **Gemini / Google API** key in chat, tickets, or screenshots.
- The **`venv/`** directory is local—**each person creates their own** virtual environment on their machine.
