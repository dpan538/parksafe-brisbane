// map.js — Leaflet initialisation and all map layer management

const BRISBANE = [-27.4698, 153.0251];
const ZOOM = 12;

let mapInstance = null;
let routeLayers = [];
let riskLayers = [];
let parkingLayer = null;

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
  return mapInstance;
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
    })
      .bindPopup(
        `
  <div style="font-family:system-ui,sans-serif;font-size:12px;
              line-height:1.6;min-width:140px;">
    <div style="font-weight:600;color:#1c1a17;margin-bottom:4px;">
      Public parking
    </div>
    <div style="color:#5c564d;">OpenStreetMap data</div>
    <div style="color:#9b9289;font-size:11px;margin-top:4px;">
      Click to dismiss
    </div>
  </div>
`,
        { maxWidth: 200 },
      )
      .on('click', function () {
        this.openPopup();
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