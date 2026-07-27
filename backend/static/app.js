// UGV FleetTrack — Mobile Dashboard Logic & Indoor Noise Hardening

let map;
let marker;
let polyline;
let currentTileLayer = null;
let pathCoordinates = [];
let totalDistanceMeters = 0.0;

// Strict Indoor & Stationary Noise Hardening Thresholds
let anchorLat = null;
let anchorLon = null;
const DISPLACEMENT_THRESHOLD_METERS = 15.0; // Requires at least 15m real movement
const SPEED_THRESHOLD_KMH = 3.5;           // Ignores speed noise < 3.5 km/h
const MAX_ALLOWED_HDOP = 1.8;               // Ignores indoor multipath noise HDOP > 1.8
const MIN_REQUIRED_SATELLITES = 7;           // Requires at least 7 satellite locks

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
                width: 36px;
                height: 36px;
                background: linear-gradient(135deg, #0284C7, #2563EB);
                border: 3px solid #FFFFFF;
                border-radius: 50%;
                box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4);
                display: flex;
                align-items: center;
                justify-content: center;
                color: #FFF;
                font-size: 16px;
            ">
                <i class="fa-solid fa-car"></i>
            </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
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
                        // Strict Indoor Hardening Filter: Displacement >= 15m AND Speed >= 3.5 km/h AND HDOP <= 1.8 AND Sats >= 7
                        if (dist >= DISPLACEMENT_THRESHOLD_METERS && dist < 500 && sats >= MIN_REQUIRED_SATELLITES && hdop <= MAX_ALLOWED_HDOP && speed >= SPEED_THRESHOLD_KMH) {
                            totalDistanceMeters += dist;
                            pathCoordinates.push([lat, lon]);
                            anchorLat = lat;
                            anchorLon = lon;
                        }
                    } else {
                        anchorLat = lat;
                        anchorLon = lon;
                    }
                }
            });

            polyline.setLatLngs(pathCoordinates);
            document.getElementById("distanceVal").innerHTML = `${totalDistanceMeters.toFixed(1)} <small>m</small>`;

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
        document.getElementById("motionStatusBadge").className = "motion-status parked";
        document.getElementById("motionStatusBadge").innerText = "OFFLINE";
    }
}

function updateDashboard(data) {
    const bat = data.battery || 4.2;
    document.getElementById("batteryVal").innerText = `${bat.toFixed(1)}V`;
    
    const rssi = data.rssi || 0;
    document.getElementById("rssiVal").innerText = `${rssi} CSQ`;

    const sats = data.satellites || 0;
    const hdop = data.hdop || 1.0;
    const fixMode = data.fix_mode !== undefined ? data.fix_mode : (data.fix_valid ? 3 : 0);
    const fixBadge = document.getElementById("fixModeBadge");

    document.getElementById("satellitesVal").innerText = sats;

    const isQualityFix = (fixMode >= 3 && sats >= MIN_REQUIRED_SATELLITES && hdop <= MAX_ALLOWED_HDOP);

    if (fixMode === 4) {
        fixBadge.innerText = "DGPS (Sub-Meter)";
        fixBadge.style.color = "#0284C7";
    } else if (isQualityFix) {
        fixBadge.innerText = "3D GNSS (High Acc)";
        fixBadge.style.color = "#10B981";
    } else if (sats >= 4 && sats < MIN_REQUIRED_SATELLITES) {
        fixBadge.innerText = "2D Fix (Low Acc)";
        fixBadge.style.color = "#F59E0B";
    } else {
        fixBadge.innerText = "Indoor Noise / No Fix";
        fixBadge.style.color = "#EF4444";
    }

    const lat = data.latitude || 0.0;
    const lon = data.longitude || 0.0;
    const alt = data.altitude || 0.0;
    let rawSpeed = data.speed || 0.0;

    document.getElementById("latVal").innerText = `${lat.toFixed(6)}°`;
    document.getElementById("lonVal").innerText = `${lon.toFixed(6)}°`;
    document.getElementById("altVal").innerText = `${alt.toFixed(1)} m`;

    const isOnline = (data.online !== false);
    const motionBadge = document.getElementById("motionStatusBadge");

    if (!isOnline) {
        motionBadge.className = "motion-status parked";
        motionBadge.innerText = "OFFLINE";
        fixBadge.innerText = "Hardware Offline";
        fixBadge.style.color = "#EF4444";
        document.getElementById("speedVal").innerText = "0.0";
        return;
    }

    let displaySpeed = (rawSpeed >= SPEED_THRESHOLD_KMH && isQualityFix) ? rawSpeed : 0.0;
    document.getElementById("speedVal").innerText = displaySpeed.toFixed(1);

    if (displaySpeed >= SPEED_THRESHOLD_KMH) {
        motionBadge.className = "motion-status moving";
        motionBadge.innerText = "MOVING";
    } else {
        motionBadge.className = "motion-status parked";
        motionBadge.innerText = "PARKED";
    }

    if (lat !== 0 && lon !== 0 && fixMode >= 2) {
        const currentPos = [lat, lon];

        if (anchorLat !== null && anchorLon !== null) {
            const displacement = haversineDistance(anchorLat, anchorLon, lat, lon);

            if (displacement < DISPLACEMENT_THRESHOLD_METERS || !isQualityFix || displaySpeed < SPEED_THRESHOLD_KMH) {
                marker.setLatLng([anchorLat, anchorLon]);
            } else {
                totalDistanceMeters += displacement;
                document.getElementById("distanceVal").innerHTML = `${totalDistanceMeters.toFixed(1)} <small>m</small>`;

                anchorLat = lat;
                anchorLon = lon;
                pathCoordinates.push(currentPos);
                polyline.setLatLngs(pathCoordinates);
                marker.setLatLng(currentPos);
            }
        } else {
            anchorLat = lat;
            anchorLon = lon;
            marker.setLatLng(currentPos);
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
    document.getElementById("distanceVal").innerHTML = `0.0 <small>m</small>`;

    try {
        await fetch('/api/v1/telemetry/reset', { method: 'POST' });
        console.log("Server database history purged");
    } catch (e) {
        console.error("Error resetting database history:", e);
    }
}

// Calculate distance between two GPS coordinates in meters
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
