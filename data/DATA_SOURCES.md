# ParkSafe Brisbane — Data Sources

## Crime Statistics

**Queensland Police Service — Crime Statistics by Location**
- URL: https://www.data.qld.gov.au/dataset/crime-statistics-location-by-offence-type
- Format: CSV, updated quarterly
- Licence: Creative Commons Attribution 4.0
- Used for: suburb-level motor vehicle theft incident counts

**QPS Crime Statistics Interactive Tool**
- URL: https://www.police.qld.gov.au/maps-and-statistics
- Used for: reference and validation of suburb risk rankings

## Mapping & Geocoding

**OpenStreetMap — Nominatim Geocoding**
- URL: https://nominatim.openstreetmap.org
- Used for: converting postcodes to lat/lng coordinates
- Licence: ODbL (OpenStreetMap contributors)
- Rate limit: 1 request/second (respected in api.js)

**OpenStreetMap — Overpass API**
- URL: https://overpass-api.de
- Used for: querying parking locations (amenity=parking) near route
- Licence: ODbL

**Leaflet.js**
- URL: https://leafletjs.com
- Version: 1.9.4
- Used for: interactive map rendering

## Population Data

**Australian Bureau of Statistics — Regional Population**
- URL: https://www.abs.gov.au/statistics/people/population/regional-population
- Used for: normalising crime counts to incidents per 100,000 population

## AI / Language Model

**Google Gemini API**
- Model: gemini-2.0-flash
- Used for: generating plain-language risk summaries
- Key stored in backend/.env (never committed to repository)

## Project data directory (repo root `data/`)

All runtime JSON and optional scraper inputs live under **`data/`** at the project root (not under `backend/data/`).

**`data/usage-log.json`**
- Local file, never transmitted externally
- Records per analyse session (see backend `app.py` whitelist)
- Purpose: studio testing session analysis (DECO7180)

**`data/parking-reviews.json`**
- Demo template buckets + user-submitted reviews via `POST /api/review`

**`data/crime-cache.json`**
- Written by `backend/scraper.py` from QPS open data

**`data/qps_raw.csv`** (optional)
- Offline fallback CSV for the scraper when the S3 download fails
