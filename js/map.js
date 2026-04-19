// map.js — Leaflet initialisation and all map layer management

const BRISBANE = [-27.4698, 153.0251];
const ZOOM = 12;

let mapInstance = null;
let routeLayers = [];
let riskLayers = [];
let parkingLayer = null;

/** Loaded from data/parking-reviews.json — template buckets for demo ratings. */
let parkingReviews = {};
/** In-memory object currently shown in the rating popup (mutated on submit). */
let currentParkingReview = null;
/** Review bucket key chosen when the popup opens (sent to POST /api/review). */
let currentParkingKey = '';
let selectedParkingStarRating = 0;

function clearEndpointMarkers() {
  if (typeof window === 'undefined') return;
  if (window._markerA) {
    mapInstance.removeLayer(window._markerA);
    window._markerA = null;
  }
  if (window._markerB) {
    mapInstance.removeLayer(window._markerB);
    window._markerB = null;
  }
}

// Initialise Leaflet map centred on Brisbane
// Returns the map instance
export function initMap() {
  mapInstance = L.map('map', {
    center: BRISBANE,
    zoom: ZOOM,
    zoomControl: false,  // we use custom buttons
    attributionControl: false,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
  }).addTo(mapInstance);

  // Wire custom zoom buttons
  document.getElementById('zoom-in').addEventListener('click', () => {
    mapInstance.zoomIn();
  });
  document.getElementById('zoom-out').addEventListener('click', () => {
    mapInstance.zoomOut();
  });

  mapInstance.invalidateSize();

  const parkPopup = document.getElementById('park-popup');
  if (parkPopup) {
    parkPopup.addEventListener('click', (e) => e.stopPropagation());
  }

  return mapInstance;
}

/** Load demo parking review templates (used when opening the rating popup). */
export async function loadParkingReviews() {
  try {
    const res = await fetch(
      `./data/parking-reviews.json?t=${Date.now()}`,
      { cache: 'no-store' },
    );
    if (!res.ok) {
      console.warn('[parking-reviews] load HTTP', res.status, res.statusText);
      parkingReviews = {};
      return;
    }
    const data = await res.json();
    parkingReviews = data.reviews || {};
  } catch (e) {
    console.warn('[parking-reviews] load failed', e);
    parkingReviews = {};
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderParkPopupComments(review) {
  const el = document.getElementById('popup-comments');
  if (!el || !review) return;
  el.innerHTML = review.comments
    .map(
      (c) => `
    <div class="park-comment">
      ${escapeHtml(c.comment || c.text)}
      <div class="park-comment__meta">${escapeHtml(c.time_of_day || c.time)} · ${escapeHtml(c.date)}</div>
    </div>
  `,
    )
    .join('');
}

function wireStarInput() {
  const starInput = document.getElementById('star-input');
  if (!starInput) return;
  selectedParkingStarRating = 0;
  starInput.innerHTML = ['★', '★', '★', '★', '★']
    .map((s, i) => `<span data-i="${i + 1}">${s}</span>`)
    .join('');
  starInput.querySelectorAll('span').forEach((s) => {
    s.addEventListener('mouseenter', () => {
      const n = parseInt(s.dataset.i, 10);
      starInput.querySelectorAll('span').forEach((x, j) => {
        x.classList.toggle('active', j < n);
      });
    });
    s.addEventListener('click', () => {
      selectedParkingStarRating = parseInt(s.dataset.i, 10);
    });
    s.addEventListener('mouseleave', () => {
      starInput.querySelectorAll('span').forEach((x, j) => {
        x.classList.toggle('active', j < selectedParkingStarRating);
      });
    });
  });
}

function openParkRatingPopup(f) {
  const overlay = document.getElementById('park-overlay');
  const popup = document.getElementById('park-popup');
  const mapEl = document.getElementById('map');
  if (!overlay || !popup || !mapEl || !mapInstance) return;

  if (typeof window !== 'undefined' && window._parksafeMarkParkingClick) {
    window._parksafeMarkParkingClick();
  }

  const point = mapInstance.latLngToContainerPoint([f.lat, f.lng]);
  const rect = mapEl.getBoundingClientRect();

  const key = Math.random() > 0.5 ? 'monitored' : 'default';
  const review =
    parkingReviews[key] ||
    parkingReviews.default ||
    ({
      name: 'Parking',
      ratings: [3],
      comments: [],
    });
  currentParkingReview = review;
  currentParkingKey = key;

  overlay.style.display = 'block';

  popup.style.display = 'block';

  let left = rect.left + point.x + 12;
  let top = rect.top + point.y - 80;

  if (left + 280 > window.innerWidth) left = rect.left + point.x - 292;
  if (top < rect.top) top = rect.top + point.y + 12;

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  const avg = (
    review.ratings.reduce((a, b) => a + b, 0) / review.ratings.length
  ).toFixed(1);

  document.getElementById('popup-name').textContent = f.name || review.name;
  document.getElementById('popup-meta').textContent =
    `OpenStreetMap · ${review.ratings.length} ratings`;
  document.getElementById('popup-avg').textContent = avg;

  const filled = Math.round(parseFloat(avg));
  document.getElementById('popup-stars').textContent =
    '★'.repeat(filled) + '☆'.repeat(5 - filled);

  renderParkPopupComments(review);

  wireStarInput();

  const ta = document.getElementById('popup-textarea');
  if (ta) ta.value = '';

  document.getElementById('popup-close').onclick = closeParkPopup;
  overlay.onclick = closeParkPopup;

  document.getElementById('popup-submit').onclick = () => {
    const text = document.getElementById('popup-textarea').value.trim();
    if (!text || !selectedParkingStarRating) return;
    const selectedRating = selectedParkingStarRating;
    const now = new Date();
    const entry = {
      text,
      time:
        now.getHours() < 12
          ? 'Morning'
          : now.getHours() < 18
            ? 'Afternoon'
            : now.getHours() < 22
              ? 'Evening'
              : 'Night',
      date: now.toLocaleDateString('en-AU', {
        month: 'short',
        year: 'numeric',
      }),
    };
    currentParkingReview.comments.unshift(entry);
    currentParkingReview.ratings.push(selectedRating);
    document.getElementById('popup-textarea').value = '';
    selectedParkingStarRating = 0;
    renderParkPopupComments(currentParkingReview);
    const newAvg = (
      currentParkingReview.ratings.reduce((a, b) => a + b, 0) /
      currentParkingReview.ratings.length
    ).toFixed(1);
    document.getElementById('popup-avg').textContent = newAvg;
    const f2 = Math.round(parseFloat(newAvg));
    document.getElementById('popup-stars').textContent =
      '★'.repeat(f2) + '☆'.repeat(5 - f2);
    wireStarInput();
    document.getElementById('popup-meta').textContent =
      `OpenStreetMap · ${currentParkingReview.ratings.length} ratings`;

    const apiBase = 'http://127.0.0.1:5000';
    (async () => {
      try {
        const res = await fetch(apiBase + '/api/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            park_key: currentParkingKey || 'default',
            name: f.name || review.name,
            rating: selectedRating,
            comment: text,
            time_of_day: entry.time,
            date: entry.date,
            session_origin:
              typeof window !== 'undefined' ? window._currentOrigin || '' : '',
            session_dest:
              typeof window !== 'undefined' ? window._currentDest || '' : '',
          }),
        });
        let payload = null;
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          try {
            payload = await res.json();
          } catch (_) {
            /* ignore */
          }
        }
        if (!res.ok) {
          console.error(
            '[parking-review] POST failed',
            res.status,
            res.statusText,
            payload,
          );
          return;
        }
        if (payload && payload.saved === false) {
          console.error('[parking-review] server rejected', payload.error || payload);
          return;
        }
        console.log('[parking-review] saved OK', currentParkingKey);
      } catch (err) {
        console.error(
          '[parking-review] network error — is Flask running on :5000?',
          err,
        );
      }
    })();
  };
}

/** Hide the parking rating overlay and popup. */
export function closeParkPopup() {
  const popup = document.getElementById('park-popup');
  const overlay = document.getElementById('park-overlay');
  if (popup) popup.style.display = 'none';
  if (overlay) {
    overlay.style.display = 'none';
    overlay.onclick = null;
  }
  currentParkingReview = null;
  currentParkingKey = '';
}

// Draw primary + optional alternative polylines (routes from fetchRoute)
export function drawRoute(routes) {
  routeLayers.forEach((l) => mapInstance.removeLayer(l));
  routeLayers = [];

  // Alternative route — drawn first (behind), lighter style
  if (routes.length > 1) {
    const altLayer = L.polyline(routes[1], {
      color: '#9b9289',
      weight: 2,
      opacity: 0.5,
      dashArray: '4 6',
    })
      .bindTooltip('Alternative route — lower risk', { sticky: true })
      .addTo(mapInstance);
    routeLayers.push(altLayer);
  }

  // Primary route — drawn on top, solid
  const mainLayer = L.polyline(routes[0], {
    color: '#1c1a17',
    weight: 2.5,
    opacity: 0.7,
    dashArray: '7 5',
  })
    .bindTooltip('Your route', { sticky: true })
    .addTo(mapInstance);
  routeLayers.push(mainLayer);

  mapInstance.fitBounds(mainLayer.getBounds(), { padding: [60, 60] });
}

export function addEndpointMarkers(latLngA, latLngB) {
  clearEndpointMarkers();

  const styleA = {
    radius: 7,
    fillColor: '#1c1a17',
    fillOpacity: 1,
    color: '#f7f4ef',
    weight: 2,
  };
  const styleB = {
    radius: 7,
    fillColor: '#b84040',
    fillOpacity: 1,
    color: '#f7f4ef',
    weight: 2,
  };

  window._markerA = L.circleMarker([latLngA.lat, latLngA.lng], styleA)
    .bindTooltip('Origin', { direction: 'top' })
    .addTo(mapInstance);
  window._markerB = L.circleMarker([latLngB.lat, latLngB.lng], styleB)
    .bindTooltip('Destination', { direction: 'top' })
    .addTo(mapInstance);
}

// Add coloured risk zone circles from an array of zone objects
// zone: { lat, lng, rank: 'high'|'medium'|'low', name }
export function addRiskZones(zones) {
  clearRiskZones();
  zones.forEach(zone => {
    const colors = {
      high:   { fill: '#b84040', stroke: '#b84040' },
      medium: { fill: '#c4812a', stroke: '#c4812a' },
      low:    { fill: '#4a7c5f', stroke: '#4a7c5f' },
    };
    const c = colors[zone.rank] || colors.medium;

    const circle = L.circle([zone.lat, zone.lng], {
      radius: 400,
      fillColor: c.fill,
      fillOpacity: 0.22,
      color: c.stroke,
      weight: 1.5,
      opacity: 0.75,
    }).addTo(mapInstance);

    circle.bindTooltip(zone.name, {
      permanent: false,
      direction: 'top',
      className: 'map-tooltip',
    });

    riskLayers.push(circle);
  });
}

// Add small green square markers for parking locations
// features: array of { lat, lng, name? }
export function addParkingMarkers(features) {
  if (parkingLayer) mapInstance.removeLayer(parkingLayer);
  const markers = features.map((f) => {
    const marker = L.circleMarker([f.lat, f.lng], {
      radius: 5,
      fillColor: '#4a7c5f',
      fillOpacity: 1,
      color: '#f7f4ef',
      weight: 1.5,
    }).on('click', (e) => {
      if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
      openParkRatingPopup(f);
    });
    return marker;
  });
  parkingLayer = L.layerGroup(markers).addTo(mapInstance);
}

// Remove all risk zone layers
function clearRiskZones() {
  riskLayers.forEach(l => mapInstance.removeLayer(l));
  riskLayers = [];
}

// Remove all layers and reset map view
export function clearAll() {
  closeParkPopup();
  routeLayers.forEach((l) => mapInstance.removeLayer(l));
  routeLayers = [];
  if (parkingLayer) mapInstance.removeLayer(parkingLayer);
  clearEndpointMarkers();
  clearRiskZones();
  parkingLayer = null;
  mapInstance.setView(BRISBANE, ZOOM);
}

// Fly map to a searched location and show a temporary marker
// Marker fades after 3 seconds
export function flyToPlace(lat, lng, label) {
  mapInstance.flyTo([lat, lng], 15, { duration: 1.2 });

  const marker = L.circleMarker([lat, lng], {
    radius: 8,
    fillColor: '#c96a2b',
    fillOpacity: 1,
    color: '#f7f4ef',
    weight: 2,
  })
    .bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -10] })
    .addTo(mapInstance);

  setTimeout(() => mapInstance.removeLayer(marker), 3000);
}