// UGV Command Center — Dashboard Logic

let map;
let marker;
let polyline;
let currentTileLayer = null;
let pathCoordinates = [];
let totalDistanceMeters = 0.0;
let lastLat = null;
let lastLon = null;

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

    // Add Zoom Control to Bottom Right
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
                if (item.latitude && item.longitude && (item.latitude !== 0 || item.longitude !== 0)) {
                    const lat = item.latitude;
                    const lon = item.longitude;

                    if (lastLat !== null && lastLon !== null) {
                        totalDistanceMeters += haversineDistance(lastLat, lastLon, lat, lon);
                    }

                    lastLat = lat;
                    lastLon = lon;
                    pathCoordinates.push([lat, lon]);
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
    }
}

function updateDashboard(data) {
    // 1. Status Indicator
    document.getElementById("statusPulse").className = "status-indicator online";
    document.getElementById("systemState").innerText = "SYSTEM LIVE";
    document.getElementById("lastUpdated").innerText = `Updated: ${data.timestamp || new Date().toLocaleTimeString()}`;
    document.getElementById("deviceId").innerText = data.device_id || "UGV-01";

    // 2. Speed Gauge
    const speed = data.speed || 0.0;
    document.getElementById("speedVal").innerText = speed.toFixed(1);
    const speedPercent = Math.min((speed / 30) * 100, 100);
    document.getElementById("speedBar").style.width = `${speedPercent}%`;

    // 3. Satellites
    const sats = data.satellites || 0;
    document.getElementById("satellitesVal").innerText = sats;
    document.getElementById("fixStatus").innerText = data.fix_valid ? "3D FIX OK" : "Searching Satellites...";

    // 4. RSSI (CSQ)
    const rssi = data.rssi || 0;
    document.getElementById("rssiVal").innerText = `${rssi} CSQ`;
    const signalBars = document.getElementById("signalBars");
    let activeLevel = 0;
    if (rssi > 20) activeLevel = 4;
    else if (rssi > 14) activeLevel = 3;
    else if (rssi > 8) activeLevel = 2;
    else if (rssi > 0) activeLevel = 1;
    signalBars.className = `signal-bars active-${activeLevel}`;

    // 5. Battery
    const bat = data.battery || 4.2;
    document.getElementById("batteryVal").innerText = `${bat.toFixed(1)} V`;
    const batPercent = Math.min(Math.max(((bat - 3.3) / 0.9) * 100, 0), 100);
    document.getElementById("batteryBar").style.width = `${batPercent}%`;

    // 6. Position & Coordinates
    const lat = data.latitude || 0.0;
    const lon = data.longitude || 0.0;
    const alt = data.altitude || 0.0;
    const heading = data.heading || 0.0;

    document.getElementById("latVal").innerText = `${lat.toFixed(6)}°`;
    document.getElementById("lonVal").innerText = `${lon.toFixed(6)}°`;
    document.getElementById("altVal").innerText = `${alt.toFixed(1)} m`;
    document.getElementById("headingVal").innerText = `${heading.toFixed(1)}°`;

    // 7. Map & Polyline Trail Update
    if (lat !== 0 && lon !== 0) {
        const newLatLng = [lat, lon];

        if (lastLat !== null && lastLon !== null && (lastLat !== lat || lastLon !== lon)) {
            const dist = haversineDistance(lastLat, lastLon, lat, lon);
            if (dist < 1000) { // filter GPS jumps > 1km
                totalDistanceMeters += dist;
                document.getElementById("distanceVal").innerHTML = `${totalDistanceMeters.toFixed(1)} <small>meters</small>`;
            }
        }

        lastLat = lat;
        lastLon = lon;

        marker.setLatLng(newLatLng);
        marker.setPopupContent(`
            <div style="font-family: sans-serif; font-size: 13px;">
                <b>UGV-TRACKER-01</b><br>
                Lat: ${lat.toFixed(6)}<br>
                Lon: ${lon.toFixed(6)}<br>
                Speed: ${speed.toFixed(1)} km/h<br>
                Sats: ${sats}
            </div>
        `);

        pathCoordinates.push(newLatLng);
        polyline.setLatLngs(pathCoordinates);
    }
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
