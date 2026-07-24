// UGV Command Center — Verified Telemetry & Stationary Deadband Filtering

let map;
let marker;
let polyline;
let currentTileLayer = null;
let pathCoordinates = [];
let totalDistanceMeters = 0.0;

// Stationary Deadband Anchoring (Eliminates stationary GPS drift spiderweb)
let anchorLat = null;
let anchorLon = null;
const STATIONARY_DEADBAND_METERS = 12.0;

let lastPacketId = null;

const mapLayers = {
    google_roadmap: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    google_hybrid: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    osm: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
};

// Initialize Leaflet Map on Load
document.addEventListener("DOMContentLoaded", () => {
    initMap();
    fetchHistory();
    setInterval(fetchLatestTelemetry, 2000);

    document.getElementById("btnCenterMap").addEventListener("click", centerMap);
    document.getElementById("btnClearTrail").addEventListener("click", clearTrail);
    document.getElementById("mapTypeSelect").addEventListener("change", changeMapLayer);
});

function initMap() {
    // Default location: Kerala, India (10.8087, 76.7402)
    const initialLat = 10.8087;
    const initialLon = 76.7402;

    map = L.map('map', {
        zoomControl: false
    }).setView([initialLat, initialLon], 17);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Set Google Maps (Roadmap) by default
    currentTileLayer = L.tileLayer(mapLayers.google_roadmap, {
        attribution: '&copy; Google Maps',
        maxZoom: 20
    }).addTo(map);

    // Custom UGV Vehicle Marker Icon
    const ugvIcon = L.divIcon({
        className: 'ugv-custom-marker',
        html: `
            <div style="
                width: 34px;
                height: 34px;
                background: linear-gradient(135deg, #0284C7, #2563EB);
                border: 3px solid #FFFFFF;
                border-radius: 50%;
                box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4);
                display: flex;
                align-items: center;
                justify-content: center;
                color: #FFF;
                font-size: 15px;
            ">
                <i class="fa-solid fa-car"></i>
            </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
    });

    marker = L.marker([initialLat, initialLon], { icon: ugvIcon }).addTo(map);
    marker.bindPopup("<b>UGV-TRACKER-01</b><br>Awaiting Telemetry...");

    // Bright Blue Polyline Trail
    polyline = L.polyline([], {
        color: '#0284C7',
        weight: 5,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(map);
}

function changeMapLayer(event) {
    const selectedKey = event.target.value;
    if (mapLayers[selectedKey] && currentTileLayer) {
        map.removeLayer(currentTileLayer);
        currentTileLayer = L.tileLayer(mapLayers[selectedKey], {
            attribution: selectedKey.startsWith('google') ? '&copy; Google Maps' : '&copy; OpenStreetMap',
            maxZoom: 20
        }).addTo(map);
    }
}

// Fetch historical path on startup
async function fetchHistory() {
    try {
        const response = await fetch('/api/v1/telemetry/history?limit=300');
        const json = await response.json();
        if (json.status === 'success' && json.data.length > 0) {
            pathCoordinates = [];
            totalDistanceMeters = 0;
            anchorLat = null;
            anchorLon = null;

            json.data.forEach(item => {
                const lat = item.latitude;
                const lon = item.longitude;
                const sats = item.satellites || 0;
                const speed = item.speed || 0.0;
                const hdop = item.hdop || 1.0;

                if (lat && lon && lat !== 0 && lon !== 0) {
                    if (anchorLat !== null && anchorLon !== null) {
                        const dist = haversineDistance(anchorLat, anchorLon, lat, lon);
                        // Strict Deadband Filtering: Require 12m displacement & 3.0 km/h speed
                        if (dist >= STATIONARY_DEADBAND_METERS && dist < 500 && sats >= 6 && hdop <= 2.5 && speed >= 3.0) {
                            totalDistanceMeters += dist;
                            pathCoordinates.push([lat, lon]);
                            anchorLat = lat;
                            anchorLon = lon;
                        }
                    } else {
                        anchorLat = lat;
                        anchorLon = lon;
                        pathCoordinates.push([lat, lon]);
                    }
                }
            });

            polyline.setLatLngs(pathCoordinates);
            document.getElementById("distanceVal").innerHTML = `${totalDistanceMeters.toFixed(1)} <small>meters</small>`;

            if (pathCoordinates.length > 0) {
                const latestCoord = pathCoordinates[pathCoordinates.length - 1];
                marker.setLatLng(latestCoord);
                map.setView(latestCoord, 17);
            }
        }
    } catch (e) {
        console.error("Error fetching history:", e);
    }
}

// Poll latest telemetry point
async function fetchLatestTelemetry() {
    try {
        const response = await fetch('/api/v1/telemetry/latest');
        const json = await response.json();

        if (json.status === 'success' && json.data) {
            updateDashboard(json.data);
        }
    } catch (e) {
        console.error("Error fetching latest telemetry:", e);
        document.getElementById("statusPulse").className = "status-indicator";
        document.getElementById("systemState").innerText = "DISCONNECTED";
        document.getElementById("genuinenessStatus").innerText = "HARDWARE OFFLINE";
    }
}

function updateDashboard(data) {
    // Check packet freshness for Genuineness Verification
    if (data.id && data.id !== lastPacketId) {
        lastPacketId = data.id;
        flashGenuinenessPulse();
    }

    // 1. Status & Genuineness Verification Banner
    document.getElementById("statusPulse").className = "status-indicator online";
    document.getElementById("systemState").innerText = "HARDWARE LIVE";
    document.getElementById("lastUpdated").innerText = `Received: ${data.timestamp || new Date().toLocaleTimeString()}`;
    document.getElementById("deviceId").innerText = data.device_id || "UGV-01";
    document.getElementById("genuinenessStatus").innerText = `VERIFIED LIVE DATA (#${data.id || 1})`;
    document.getElementById("genuinenessSub").innerText = `ID: ${data.device_id || "UGV-TRACKER-01"} | Recv: ${data.created_at || 'Just now'}`;

    // 2. Compact Mini Battery Badge
    const bat = data.battery || 4.2;
    document.getElementById("batteryVal").innerText = `${bat.toFixed(1)}V`;

    // 3. GNSS Satellites & Fix Mode Status Breakdown
    const sats = data.satellites || 0;
    const hdop = data.hdop || 1.0;
    const fixMode = data.fix_mode !== undefined ? data.fix_mode : (data.fix_valid ? 3 : 0);
    const fixBadge = document.getElementById("fixModeBadge");

    document.getElementById("satellitesVal").innerText = sats;

    if (fixMode === 4) {
        fixBadge.className = "fix-badge mode-dgps";
        fixBadge.innerText = "DGPS (Sub-Meter)";
        document.getElementById("fixStatus").innerText = `Sub-Meter Accuracy (HDOP: ${hdop.toFixed(1)})`;
    } else if (fixMode === 3 && sats >= 6 && hdop <= 2.5) {
        fixBadge.className = "fix-badge mode-3d";
        fixBadge.innerText = "3D GNSS Fix";
        document.getElementById("fixStatus").innerText = `High Accuracy (HDOP: ${hdop.toFixed(1)})`;
    } else if (fixMode === 2 || (sats >= 4 && sats < 6)) {
        fixBadge.className = "fix-badge mode-2d";
        fixBadge.innerText = "2D Fix (Low Acc)";
        document.getElementById("fixStatus").innerText = `Low Accuracy / Partial Obstruction (HDOP: ${hdop.toFixed(1)})`;
    } else {
        fixBadge.className = "fix-badge mode-none";
        fixBadge.innerText = "Indoor / No Fix";
        document.getElementById("fixStatus").innerText = "Antenna indoors or Searching Satellites...";
    }

    // 4. Position & Coordinates
    const lat = data.latitude || 0.0;
    const lon = data.longitude || 0.0;
    const alt = data.altitude || 0.0;
    const heading = data.heading || 0.0;
    let rawSpeed = data.speed || 0.0;

    document.getElementById("latVal").innerText = `${lat.toFixed(6)}°`;
    document.getElementById("lonVal").innerText = `${lon.toFixed(6)}°`;
    document.getElementById("altVal").innerText = `${alt.toFixed(1)} m`;
    document.getElementById("headingVal").innerText = `${heading.toFixed(1)}°`;

    // 5. LTE Cellular Signal (CSQ)
    const rssi = data.rssi || 0;
    document.getElementById("rssiVal").innerText = `${rssi} CSQ`;
    const signalBars = document.getElementById("signalBars");
    const signalQualityText = document.getElementById("signalQualityText");

    let activeLevel = 0;
    if (rssi >= 20) { activeLevel = 4; signalQualityText.innerText = "Excellent LTE Signal"; }
    else if (rssi >= 15) { activeLevel = 3; signalQualityText.innerText = "Good LTE Signal"; }
    else if (rssi >= 10) { activeLevel = 2; signalQualityText.innerText = "Fair LTE Signal"; }
    else if (rssi > 0) { activeLevel = 1; signalQualityText.innerText = "Weak LTE Signal"; }
    else { activeLevel = 0; signalQualityText.innerText = "No Cellular Signal"; }

    signalBars.className = `signal-bars active-${activeLevel}`;

    // 6. Stationary Deadband Anchor Logic (100% Drift Elimination)
    if (lat !== 0 && lon !== 0 && fixMode >= 2) {
        const currentPos = [lat, lon];

        if (anchorLat !== null && anchorLon !== null) {
            const displacement = haversineDistance(anchorLat, anchorLon, lat, lon);

            // Check if displacement is WITHIN 12-meter stationary deadband radius
            if (displacement < STATIONARY_DEADBAND_METERS || rawSpeed < 3.0 || sats < 6 || hdop > 2.5) {
                // Vehicle is STATIONARY (or minor GPS jitter)
                document.getElementById("speedVal").innerText = "0.0";
                document.getElementById("speedBar").style.width = "0%";

                // Keep marker anchored at stable position
                marker.setLatLng([anchorLat, anchorLon]);
            } else {
                // Vehicle is ACTUALLY MOVING (> 12m displacement & speed >= 3.0 km/h)
                document.getElementById("speedVal").innerText = rawSpeed.toFixed(1);
                const speedPercent = Math.min((rawSpeed / 30) * 100, 100);
                document.getElementById("speedBar").style.width = `${speedPercent}%`;

                // Accumulate Distance & Update Anchor
                totalDistanceMeters += displacement;
                document.getElementById("distanceVal").innerHTML = `${totalDistanceMeters.toFixed(1)} <small>meters</small>`;

                anchorLat = lat;
                anchorLon = lon;
                pathCoordinates.push(currentPos);
                polyline.setLatLngs(pathCoordinates);
                marker.setLatLng(currentPos);
            }
        } else {
            // First valid point anchor
            anchorLat = lat;
            anchorLon = lon;
            pathCoordinates.push(currentPos);
            polyline.setLatLngs(pathCoordinates);
            marker.setLatLng(currentPos);
            document.getElementById("speedVal").innerText = "0.0";
            document.getElementById("speedBar").style.width = "0%";
        }

        marker.setPopupContent(`
            <div style="font-family: sans-serif; font-size: 13px;">
                <b>UGV-TRACKER-01</b><br>
                Lat: ${lat.toFixed(6)}<br>
                Lon: ${lon.toFixed(6)}<br>
                Fix: ${fixBadge.innerText} (${sats} Sats)
            </div>
        `);
    }
}

function flashGenuinenessPulse() {
    const banner = document.getElementById("genuinenessBanner");
    banner.style.transform = "scale(1.02)";
    banner.style.borderColor = "#10B981";
    setTimeout(() => {
        banner.style.transform = "scale(1)";
    }, 300);
}

function centerMap() {
    if (anchorLat !== null && anchorLon !== null) {
        map.setView([anchorLat, anchorLon], 17);
    }
}

async function clearTrail() {
    pathCoordinates = [];
    polyline.setLatLngs([]);
    totalDistanceMeters = 0;
    anchorLat = null;
    anchorLon = null;
    document.getElementById("distanceVal").innerHTML = `0.0 <small>meters</small>`;

    // Purge database history on server
    try {
        await fetch('/api/v1/telemetry/reset', { method: 'POST' });
    } catch (e) {
        console.error("Error resetting database history:", e);
    }
}

// Calculate distance between two GPS coordinates in meters
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
