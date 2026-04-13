// api.js — external HTTP requests: Nominatim geocoding + Overpass parking query

const NOMINATIM = 'https://nominatim.openstreetmap.org';
// Public mirrors — hit in parallel; first 200 + JSON wins (avoids waiting on a slow 504).
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const UA = 'ParkSafe-Brisbane/1.0 (DECO7180 student project)';
const OVERPASS_PER_TRY_MS = 16000;

// Geocode a Brisbane postcode to {lat, lng, suburb}
// Returns null on failure
export async function geocodePostcode(postcode) {
  try {
    const url = `${NOMINATIM}/search?` + new URLSearchParams({
      q: `${postcode}, Brisbane, Queensland, Australia`,
      format: 'json',
      limit: 1,
      countrycodes: 'au',
    });
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const data = await res.json();
    if (!data.length) return null;
    return {
      lat:    parseFloat(data[0].lat),
      lng:    parseFloat(data[0].lon),
      suburb: data[0].display_name.split(',')[0].trim(),
    };
  } catch (err) {
    console.error('geocodePostcode failed:', err);
    return null;
  }
}

function parkingFromOverpassJson(data) {
  return (data.elements || [])
    .filter((el) => el.type === 'node' && typeof el.lat === 'number')
    .map((el) => ({ lat: el.lat, lng: el.lon }));
}

/**
 * Single mirror attempt with client-side timeout.
 * Resolves to { url, nodes }; rejects on network / HTTP / JSON errors.
 */
function tryOverpassMirror(url, query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERPASS_PER_TRY_MS);
  const req = fetch(url, {
    method: 'POST',
    body: query,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.remark) console.warn('[api] Overpass remark', url, data.remark);
    return { url, nodes: parkingFromOverpassJson(data) };
  });
  return req.finally(() => clearTimeout(timer));
}

// Query Overpass for parking nodes within a bounding box.
// bounds: { south, west, north, east }
// Returns array of { lat, lng } on success (may be empty), or null if every mirror failed.
export async function fetchParkingNearRoute(bounds) {
  const { south, west, north, east } = bounds;
  const query = `[out:json][timeout:12];
node["amenity"="parking"](${south},${west},${north},${east});
out body;`;

  const tasks = OVERPASS_ENDPOINTS.map((url) =>
    tryOverpassMirror(url, query).catch((err) => {
      const reason =
        err.name === 'AbortError' ? 'timeout' : err.message || String(err);
      console.warn('[api] Overpass miss', url, reason);
      throw err;
    }),
  );

  try {
    const { url, nodes } = await Promise.any(tasks);
    console.info('[api] Overpass OK', url, nodes.length, 'parking nodes');
    return nodes;
  } catch (e) {
    if (e instanceof AggregateError) {
      console.error(
        '[api] All Overpass mirrors failed (safe parks unavailable)',
        e.errors?.length ?? 0,
        'errors',
      );
    } else {
      console.error('[api] Overpass unexpected', e);
    }
    return null;
  }
}

// Fetch real driving route from OSRM public demo server
// latLngA, latLngB: {lat, lng} objects
// Returns array of route point arrays — first is primary, rest are alts — or null on failure
export async function fetchRoute(latLngA, latLngB) {
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${latLngA.lng},${latLngA.lat};${latLngB.lng},${latLngB.lat}` +
      `?overview=full&geometries=geojson&alternatives=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = await res.json();
    if (!data.routes || !data.routes.length) return null;

    // Return array of route point arrays — first is primary, rest are alts
    return data.routes.map((route) =>
      route.geometry.coordinates.map((c) => [c[1], c[0]]),
    );
  } catch (err) {
    console.error('fetchRoute failed:', err);
    return null;
  }
}

// Build bounding box from an array of [lat, lng] route points
// Returns { south, west, north, east }
export function routeBoundsFromPoints(points, pad = 0.008) {
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  return {
    south: Math.min(...lats) - pad,
    west: Math.min(...lngs) - pad,
    north: Math.max(...lats) + pad,
    east: Math.max(...lngs) + pad,
  };
}

// Sleep helper to respect Nominatim 1 req/sec rule
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Search for a place name in Brisbane and return its coordinates
// query: free text e.g. "South Bank", "Brisbane Airport", "Eagle Street Pier"
// Returns {lat, lng, display_name} or null on failure
export async function searchPlace(query) {
  try {
    const url = `${NOMINATIM}/search?` + new URLSearchParams({
      q: `${query}, Brisbane, Queensland, Australia`,
      format: 'json',
      limit: 1,
      countrycodes: 'au',
    });
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const data = await res.json();
    if (!data.length) return null;
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      display_name: data[0].display_name.split(',')[0].trim(),
    };
  } catch (err) {
    console.error('searchPlace failed:', err);
    return null;
  }
}

// Reverse geocode lat/lng to get the nearest postcode
// Returns postcode string e.g. "4101" or null
export async function reverseGeocode(lat, lng) {
  try {
    const url = `${NOMINATIM}/reverse?` + new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: 'json',
      addressdetails: '1',
    });
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`Nominatim reverse ${res.status}`);
    const data = await res.json();
    return data.address?.postcode?.replace(/\s/g, '').slice(0, 4) || null;
  } catch (err) {
    console.error('reverseGeocode failed:', err);
    return null;
  }
}