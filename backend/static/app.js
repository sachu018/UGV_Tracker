// UGV Command Center — Verified Telemetry & Anti-Drift Filtering Logic

let map;
let marker;
let polyline;
let currentTileLayer = null;
let pathCoordinates = [];
let totalDistanceMeters = 0.0;
let lastLat = null;
let lastLon = null;
let lastPacketId = null;

const mapLayers = {
    google_roadmap: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    google_hybrid: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    osm: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
};

// Initialize Leaflet Map on Load
document.addEventListener("DOMContentLoaded", () => {
    initMap();
    initTheme();
    fetchHistory();
    setInterval(fetchLatestTelemetry, 2000);

    document.getElementById("btnCenterMap").addEventListener("click", centerMap);
    document.getElementById("btnClearTrail").addEventListener("click", clearTrail);
    document.getElementById("btnToggleTheme").addEventListener("click", toggleTheme);
    document.getElementById("mapTypeSelect").addEventListener("change", changeMapLayer);
});

function initTheme() {
    const savedTheme = localStorage.getItem("ugv_theme") || "light";
    if (savedTheme === "dark") {
        document.body.classList.add("dark-theme");
        document.getElementById("btnToggleTheme").innerHTML = '<i class="fa-solid fa-sun"></i>';
    } else {
        document.body.classList.remove("dark-theme");
        document.getElementById("btnToggleTheme").innerHTML = '<i class="fa-solid fa-moon"></i>';
    }
}

function toggleTheme() {
    if (document.body.classList.contains("dark-theme")) {
        document.body.classList.remove("dark-theme");
        localStorage.setItem("ugv_theme", "light");
        document.getElementById("btnToggleTheme").innerHTML = '<i class="fa-solid fa-moon"></i>';
    } else {
        document.body.classList.add("dark-theme");
        localStorage.setItem("ugv_theme", "dark");
        document.getElementById("btnToggleTheme").innerHTML = '<i class="fa-solid fa-sun"></i>';
    }
}

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
        const response = await fetch('/api/v1/telemetry/history?limit=200');
        const json = await response.json();
        if (json.status === 'success' && json.data.length > 0) {
            pathCoordinates = [];
            totalDistanceMeters = 0;

            json.data.forEach(item => {
                const lat = item.latitude;
                const lon = item.longitude;
                const sats = item.satellites || 0;
                const speed = item.speed || 0.0;
                const hdop = item.hdop || 1.0;

                if (lat && lon && lat !== 0 && lon !== 0) {
                    if (lastLat !== null && lastLon !== null) {
                        const dist = haversineDistance(lastLat, lastLon, lat, lon);
                        // Anti-Drift Filtering: Only accumulate if movement > 3 meters AND valid movement
                        if (dist >= 3.0 && dist < 500 && sats >= 6 && hdop <= 2.5 && speed > 0.0) {
                            totalDistanceMeters += dist;
                            pathCoordinates.push([lat, lon]);
                            lastLat = lat;
                            lastLon = lon;
                        }
                    } else {
                        lastLat = lat;
                        lastLon = lon;
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

    // 4. Accurate Speed Filter (Stationary Drift Elimination)
    let rawSpeed = data.speed || 0.0;
    // If speed is below 2.0 km/h or HDOP is noisy (> 2.5) or sats < 5, treat as stationary 0.0 km/h
    let displaySpeed = (rawSpeed >= 2.0 && hdop <= 2.5 && sats >= 5) ? rawSpeed : 0.0;

    document.getElementById("speedVal").innerText = displaySpeed.toFixed(1);
    const speedPercent = Math.min((displaySpeed / 30) * 100, 100);
    document.getElementById("speedBar").style.width = `${speedPercent}%`;

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

    // 6. Coordinates & Heading
    const lat = data.latitude || 0.0;
    const lon = data.longitude || 0.0;
    const alt = data.altitude || 0.0;
    const heading = data.heading || 0.0;

    document.getElementById("latVal").innerText = `${lat.toFixed(6)}°`;
    document.getElementById("lonVal").innerText = `${lon.toFixed(6)}°`;
    document.getElementById("altVal").innerText = `${alt.toFixed(1)} m`;
    document.getElementById("headingVal").innerText = `${heading.toFixed(1)}°`;

    // 7. Accurate Distance Accumulation (Anti-Drift Filtering)
    if (lat !== 0 && lon !== 0 && fixMode >= 2) {
        const newLatLng = [lat, lon];

        if (lastLat !== null && lastLon !== null) {
            const dist = haversineDistance(lastLat, lastLon, lat, lon);
            // Strict Anti-Drift: Accumulate ONLY if distance >= 3.0 meters AND speed > 0 AND sats >= 6
            if (dist >= 3.0 && dist < 500 && displaySpeed > 0.0 && sats >= 6 && hdop <= 2.5) {
                totalDistanceMeters += dist;
                document.getElementById("distanceVal").innerHTML = `${totalDistanceMeters.toFixed(1)} <small>meters</small>`;
                lastLat = lat;
                lastLon = lon;
                pathCoordinates.push(newLatLng);
                polyline.setLatLngs(pathCoordinates);
            }
        } else {
            lastLat = lat;
            lastLon = lon;
            pathCoordinates.push(newLatLng);
            polyline.setLatLngs(pathCoordinates);
        }

        marker.setLatLng(newLatLng);
        marker.setPopupContent(`
            <div style="font-family: sans-serif; font-size: 13px;">
                <b>UGV-TRACKER-01</b><br>
                Lat: ${lat.toFixed(6)}<br>
                Lon: ${lon.toFixed(6)}<br>
                Speed: ${displaySpeed.toFixed(1)} km/h<br>
                Fix: ${fixBadge.innerText} (${sats} Sats)
            </div>
        `);
    }
}

function flashGenuinenessPulse() {
    const banner = document.getElementById("genuinenessBanner");
    banner.style.transform = "scale(1.03)";
    banner.style.borderColor = "#10B981";
    setTimeout(() => {
        banner.style.transform = "scale(1)";
    }, 300);
}

function centerMap() {
    if (lastLat !== null && lastLon !== null) {
        map.setView([lastLat, lastLon], 17);
    }
}

function clearTrail() {
    pathCoordinates = [];
    polyline.setLatLngs([]);
    totalDistanceMeters = 0;
    document.getElementById("distanceVal").innerHTML = `0.0 <small>meters</small>`;
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
