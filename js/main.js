// main.js — app entry point, wires all modules together

import {
    initMap,
    drawRoute,
    addEndpointMarkers,
    addRiskZones,
    addParkingMarkers,
    clearAll,
    loadParkingReviews,
} from "./map.js?v=parking-review-1";
import {
    geocodePostcode,
    fetchRoute,
    fetchParkingNearRoute,
    routeBoundsFromPoints,
    reverseGeocode,
    searchPlace,
    sleep,
} from "./api.js";
import {
    getSuburbsInBounds,
    calcRouteRisk,
    getPeakRiskPeriod,
} from "./data.js";
import { fetchRiskSummary } from "./llm.js?v=parksafe-1";

const API_BASE = "http://127.0.0.1:5000";

// Boot: load demo parking reviews, then init map (markers use review data on click).
(async () => {
    await loadParkingReviews();
    initMap();
})();

function showStatus(msg) {
    const bar = document.getElementById("status-bar");
    bar.textContent = msg;
    bar.classList.add("visible");
}

function hideStatus() {
    document.getElementById("status-bar").classList.remove("visible");
}

// Swap origin ↔ destination
document.getElementById("swap-btn").addEventListener("click", () => {
    const a = document.getElementById("input-origin");
    const b = document.getElementById("input-dest");
    [a.value, b.value] = [b.value, a.value];
});

// Topbar search — destination + user location → postcodes → auto analyse
document.getElementById("search-input").addEventListener(
    "keydown",
    async (e) => {
        if (e.key !== "Enter") return;
        const query = e.target.value.trim();
        if (!query) return;

        const input = e.target;
        const savedQuery = query;
        input.disabled = true;
        input.value = "Locating…";

        try {
            const dest = await searchPlace(savedQuery);
            if (!dest) {
                input.value = "";
                input.placeholder = "Place not found, try again";
                input.disabled = false;
                return;
            }

            const userPos = await new Promise((resolve, reject) => {
                if (!navigator.geolocation) reject(new Error("no geolocation"));
                navigator.geolocation.getCurrentPosition(
                    (p) =>
                        resolve({
                            lat: p.coords.latitude,
                            lng: p.coords.longitude,
                        }),
                    () => reject(new Error("denied")),
                );
            });

            const destPostcode = await reverseGeocode(dest.lat, dest.lng);
            await sleep(1100);
            const originPostcode = await reverseGeocode(
                userPos.lat,
                userPos.lng,
            );

            if (!destPostcode || !originPostcode) {
                input.value = "";
                input.placeholder =
                    "Could not resolve postcodes, try again";
                input.disabled = false;
                return;
            }

            document.getElementById("input-origin").value = originPostcode;
            document.getElementById("input-dest").value = destPostcode;
            input.value = dest.display_name;
            input.disabled = false;

            window._inputMethod = "search_gps";
            document.getElementById("analyse-btn").click();
        } catch (err) {
            const dest = await searchPlace(savedQuery);
            if (dest) {
                const destPostcode = await reverseGeocode(dest.lat, dest.lng);
                if (destPostcode) {
                    document.getElementById("input-dest").value =
                        destPostcode;
                    input.value = dest.display_name;
                } else {
                    input.value = savedQuery;
                }
            } else {
                input.value = savedQuery;
            }
            input.disabled = false;
            showStatus(
                "Location access denied — please enter your origin postcode manually.",
            );
        }
    },
);

// Main analyse flow
document.getElementById("analyse-btn").addEventListener("click", async () => {
    const sessionStart = Date.now();
    const inputMethodForLog = window._inputMethod || "manual";
    window._inputMethod = "manual";

    const originVal = document.getElementById("input-origin").value.trim();
    const destVal = document.getElementById("input-dest").value.trim();

    if (!originVal || !destVal) {
        showStatus("Please enter both postcodes.");
        return;
    }

    if (!/^\d{4}$/.test(originVal) || !/^\d{4}$/.test(destVal)) {
        showStatus("Please enter valid 4-digit Australian postcodes.");
        return;
    }

    window._currentSessionId = crypto.randomUUID();
    window._sessionLogPosted = false;
    window._pendingParkingClick = false;
    window._clickedParkingLogged = false;

    setLoading(true);
    clearAll();
    resetUI();

    // 1. Geocode — respect Nominatim 1 req/sec
    showStatus("Locating postcodes…");
    const origin = await geocodePostcode(originVal);
    await sleep(1100);
    const dest = await geocodePostcode(destVal);

    if (!origin) {
        showStatus(`Could not find postcode ${originVal}.`);
        setLoading(false);
        return;
    }
    if (!dest) {
        showStatus(`Could not find postcode ${destVal}.`);
        setLoading(false);
        return;
    }

    window._currentOrigin = originVal;
    window._currentDest = destVal;

    const latLngA = { lat: origin.lat, lng: origin.lng };
    const latLngB = { lat: dest.lat, lng: dest.lng };

    // 2. Driving route (OSRM) + endpoints
    showStatus("Calculating driving route…");
    const routes = await fetchRoute(latLngA, latLngB);
    if (!routes) {
        showStatus("Could not calculate route. Check your postcodes.");
        setLoading(false);
        return;
    }
    drawRoute(routes);
    addEndpointMarkers(latLngA, latLngB);

    // 3. Get suburbs along route
    const bounds = routeBoundsFromPoints(routes[0]);
    const suburbs = getSuburbsInBounds(bounds);
    const risk = calcRouteRisk(suburbs);

    // 4. Render risk zones on map
    addRiskZones(
        suburbs.map((s) => ({
            lat: s.lat,
            lng: s.lng,
            rank: s.rank,
            name: s.name,
        })),
    );

    // 5. Fetch parking from Overpass (parallel mirrors in api.js)
    showStatus("Finding safe parking…");
    const parking = await fetchParkingNearRoute(bounds);
    if (parking && parking.length) addParkingMarkers(parking);

    // 6. Update sidebar stats (null parking = all mirrors failed → "—")
    updateStats(risk, suburbs, parking);

    // 7. Update zone list panel
    renderZones(suburbs.slice(0, 6));

    // 8. Update risk index panel
    renderRiskIndex(risk);

    // Footer stats
    const peak = getPeakRiskPeriod(suburbs);
    document.getElementById("footer-peak").textContent = peak;

    const distanceKm = calcRouteDistance(routes[0]);
    const parkCount = parking === null ? 0 : parking.length;

    document.getElementById("footer-meta").innerHTML =
        `${suburbs.length} suburbs analysed<br>` +
        `${parkCount} parking spots found<br>` +
        `Route approx. ${distanceKm} km`;

    document.getElementById("footer-stats").style.display = "flex";

    if (routes[1]) {
        const altBounds = routeBoundsFromPoints(routes[1]);
        const altSuburbs = getSuburbsInBounds(altBounds);
        const altRisk = calcRouteRisk(altSuburbs);

        const altEl = document.getElementById("stat-alts");
        altEl.title = `Main route: ${risk.score}/100 | Alternative: ${altRisk.score}/100`;
        // Show relative comparison so this card is easier to interpret.
        if (altRisk.score < risk.score) {
            altEl.textContent = "Safer";
            altEl.className = "stat-cell__value stat-cell__value--safe";
        } else if (altRisk.score > risk.score) {
            altEl.textContent = "Riskier";
            altEl.className = "stat-cell__value stat-cell__value--danger";
        } else {
            altEl.textContent = "Similar";
            altEl.className = "stat-cell__value stat-cell__value--muted";
        }
    }

    if (risk.rank === "high" || risk.rank === "medium") {
        showRouteConfirm(risk, suburbs);
    } else {
        const rc = document.getElementById("route-confirm");
        if (rc) rc.style.display = "none";
    }

    const highRiskCount = suburbs.filter((s) => s.rank === "high").length;
    const parkingFoundCount = parking === null ? 0 : parking.length;
    const riskRatio =
        suburbs.length > 0
            ? parseFloat(
                  (highRiskCount / suburbs.length).toFixed(2),
              )
            : 0;
    const timeToAnalyseSec = parseFloat(
        ((Date.now() - sessionStart) / 1000).toFixed(1),
    );

    const logPayload = {
        session_id: window._currentSessionId,
        timestamp: new Date().toISOString(),
        weekday: new Date().toLocaleDateString("en-AU", { weekday: "long" }),
        time_of_day: getTimeOfDay(),
        is_weekend: [0, 6].includes(new Date().getDay()),
        origin: originVal,
        destination: destVal,
        input_method: inputMethodForLog,
        risk_score: risk.score,
        risk_rank: risk.rank,
        suburb_count: suburbs.length,
        high_risk_count: highRiskCount,
        risk_ratio: riskRatio,
        parking_found: parkingFoundCount,
        route_km: parseFloat(calcRouteDistance(routes[0])),
        time_to_analyse_sec: timeToAnalyseSec,
        proceeded: null,
        used_alternative: false,
        clicked_parking: false,
    };
    try {
        const res = await postUsageLog(logPayload);
        window._sessionLogPosted = true;
        if (res.ok && window._pendingParkingClick) {
            window._pendingParkingClick = false;
            window._clickedParkingLogged = true;
            updateLogSession({ clicked_parking: true });
        }
        if (!res.ok) window._pendingParkingClick = false;
    } catch {
        window._sessionLogPosted = true;
        window._pendingParkingClick = false;
    }

    // 9. Stream AI summary (after usage row exists so parking clicks can PATCH)
    showStatus("Generating AI summary…");
    const summaryEl = document.getElementById("ai-summary");
    await fetchRiskSummary(origin.suburb, dest.suburb, suburbs, summaryEl);

    hideStatus();
    setLoading(false);
});

// ── UI helpers ──────────────────────────────────────────

function getTimeOfDay() {
    const h = new Date().getHours();
    if (h >= 6 && h < 12) return "Morning";
    if (h >= 12 && h < 18) return "Afternoon";
    if (h >= 18 && h < 22) return "Evening";
    return "Night";
}

function showRouteConfirm(risk, suburbs) {
    const card = document.getElementById("route-confirm");
    const text = document.getElementById("confirm-text");
    if (!card || !text) return;

    const highCount = suburbs.filter((s) => s.rank === "high").length;

    text.innerHTML =
        risk.rank === "high"
            ? `Route passes through <strong>${highCount} high-risk area${highCount > 1 ? "s" : ""}.</strong><br>Peak window: ${getPeakRiskPeriod(suburbs)}.`
            : `Route includes some medium-risk areas.<br>A safer alternative is available.`;

    card.style.display = "block";

    document.getElementById("confirm-proceed").onclick = () => {
        card.style.display = "none";
        window._proceeded = true;
        updateLogSession({ proceeded: true, used_alternative: false });
    };

    document.getElementById("confirm-alt").onclick = () => {
        card.style.display = "none";
        window._proceeded = false;
        updateLogSession({ proceeded: false, used_alternative: true });
        highlightAltRoute();
    };
}

function updateLogSession(partial) {
    const sid = window._currentSessionId;
    if (!sid) return;
    fetch(API_BASE + "/api/log/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid, ...partial }),
    }).catch(() => {});
}

function markParkingClickedForSession() {
    const sid = window._currentSessionId;
    if (!sid || window._clickedParkingLogged) return;
    if (window._sessionLogPosted) {
        window._clickedParkingLogged = true;
        updateLogSession({ clicked_parking: true });
    } else {
        window._pendingParkingClick = true;
    }
}

window._parksafeMarkParkingClick = markParkingClickedForSession;

function highlightAltRoute() {
    const paths = document.querySelectorAll(
        "#map .leaflet-overlay-pane svg path.leaflet-interactive",
    );
    const altLine = paths[0];
    if (!altLine) return;
    const prev = altLine.getAttribute("stroke-width");
    altLine.setAttribute("stroke-width", "4");
    setTimeout(() => {
        if (prev != null && prev !== "") altLine.setAttribute("stroke-width", prev);
        else altLine.removeAttribute("stroke-width");
    }, 2000);
}

// Approximate route distance in km from array of [lat,lng] points
function calcRouteDistance(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        const [lat1, lng1] = points[i - 1];
        const [lat2, lng2] = points[i];
        const R = 6371;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLng = ((lng2 - lng1) * Math.PI) / 180;
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos((lat1 * Math.PI) / 180) *
                Math.cos((lat2 * Math.PI) / 180) *
                Math.sin(dLng / 2) ** 2;
        total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    return total.toFixed(1);
}

function setLoading(on) {
    document.getElementById("analyse-btn").disabled = on;
}

// Try each configured log endpoint until one accepts the POST.
function postUsageLog(payload) {
    return fetch(API_BASE + "/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
}

function resetUI() {
    document.getElementById("stat-risk").textContent = "—";
    document.getElementById("stat-risk").className =
        "stat-cell__value stat-cell__value--muted";
    document.getElementById("stat-hotspots").textContent = "—";
    document.getElementById("stat-hotspots").className =
        "stat-cell__value stat-cell__value--muted";
    document.getElementById("stat-parks").textContent = "—";
    document.getElementById("stat-parks").className =
        "stat-cell__value stat-cell__value--muted";
    document.getElementById("stat-alts").textContent = "—";
    document.getElementById("stat-alts").className =
        "stat-cell__value stat-cell__value--muted";
    document.getElementById("stat-alts").removeAttribute("title");
    document.getElementById("zone-list").innerHTML =
        '<p class="panel__placeholder">Analysing…</p>';
    document.getElementById("risk-index-panel").innerHTML =
        '<p class="risk-empty">—</p>';
    document.getElementById("ai-summary").innerHTML =
        '<span class="panel__placeholder">Analysing route…</span>';
    document.getElementById("footer-stats").style.display = "none";
    const routeConfirm = document.getElementById("route-confirm");
    if (routeConfirm) routeConfirm.style.display = "none";
}

function updateStats(risk, suburbs, parkingOrNull) {
    const riskEl = document.getElementById("stat-risk");
    riskEl.textContent = risk.label;
    riskEl.className =
        "stat-cell__value stat-cell__value--" +
        (risk.rank === "high"
            ? "danger"
            : risk.rank === "medium"
              ? "warn"
              : "safe");

    const hotEl = document.getElementById("stat-hotspots");
    const hotCount = suburbs.filter((s) => s.rank === "high").length;
    hotEl.textContent = hotCount;
    hotEl.className =
        "stat-cell__value " +
        (hotCount > 0 ? "stat-cell__value--warn" : "stat-cell__value--safe");

    const parkEl = document.getElementById("stat-parks");
    if (parkingOrNull === null || parkingOrNull === undefined) {
        parkEl.textContent = "—";
        parkEl.className = "stat-cell__value stat-cell__value--muted";
    } else {
        parkEl.textContent = String(parkingOrNull.length);
        parkEl.className = "stat-cell__value stat-cell__value--safe";
    }
}

function renderZones(suburbs) {
    if (!suburbs.length) {
        document.getElementById("zone-list").innerHTML =
            '<p class="panel__placeholder">No risk zones found along this route.</p>';
        return;
    }
    document.getElementById("zone-list").innerHTML = suburbs
        .map(
            (s) => `
    <div class="zone-row">
      <span class="zone-name">${s.name}</span>
      <span class="zone-badge zone-badge--${s.rank === "high" ? "high" : s.rank === "medium" ? "medium" : "low"}">
        ${s.rank.charAt(0).toUpperCase() + s.rank.slice(1)}
      </span>
    </div>
  `,
        )
        .join("");
}

function renderRiskIndex(risk) {
    document.getElementById("risk-index-panel").innerHTML = `
    <div class="risk-num">${risk.score}</div>
    <div class="risk-bar-wrap">
      <div class="risk-bar" style="width:${risk.score}%;background:${
          risk.rank === "high"
              ? "var(--danger)"
              : risk.rank === "medium"
                ? "var(--warn)"
                : "var(--safe)"
      }">
      </div>
    </div>
    <div class="risk-sub">${risk.label} · out of 100</div>
  `;
}
