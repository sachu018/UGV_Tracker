// UGV FleetTrack — System Power, SIM Cellular & GPS Hardware Monitoring

let map;
let marker;
let polyline;
let currentTileLayer = null;
let pathCoordinates = [];
let totalDistanceMeters = 0.0;

// Dedicated History Map Modal Variables
let historyMap = null;
let historyPolyline = null;
let historyStartMarker = null;
let historyEndMarker = null;
let historyTileLayer = null;
let cachedHistoryData = [];

// Strict Indoor & Stationary Noise Hardening Thresholds
let anchorLat = null;
let anchorLon = null;
const DISPLACEMENT_THRESHOLD_METERS = 15.0;
const SPEED_THRESHOLD_KMH = 3.5;
const MAX_ALLOWED_HDOP = 1.8;
const MIN_REQUIRED_SATELLITES = 7;

const mapLayers = {
    google_roadmap: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    google_hybrid: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    osm: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
};

// Initialize Leaflet Map on Load
document.addEventListener("DOMContentLoaded", () => {
    initMap();
    initControls();
    fetchHistory();
    setInterval(fetchLatestTelemetry, 2000);
    setInterval(updateLiveClock, 1000);
    updateLiveClock();
});

let lastKnownPacketTimeMs = null;
let latestOnlineState = false;

function updateLiveClock() {
    const now = new Date();
    const clockStr = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const clockElem = document.getElementById("liveClockVal");
    if (clockElem) clockElem.innerText = clockStr;

    // Ticking Schedule Timers strictly based on ESP32 last transmission timestamp!
    const refPacketTime = lastKnownPacketTimeMs || Date.now();
    const nowTime = now.getTime();
    const elapsedSec = Math.max(0, Math.floor((nowTime - refPacketTime) / 1000));
        
        const activeWindowMaxSec = 5 * 60; // 5 minutes active
        const sleepIntervalSec = 15 * 60;   // 15 minutes sleep

        const countdownElement = document.getElementById("countdownVal");
        const activeTimerElement = document.getElementById("activeTimerVal");
        const nextSleepElement = document.getElementById("nextSleepTimerVal");

        if (latestOnlineState) {
            const activeElapsed = Math.min(activeWindowMaxSec, elapsedSec);
            const activeMins = Math.floor(activeElapsed / 60);
            const activeSecs = activeElapsed % 60;
            if (activeTimerElement) activeTimerElement.innerText = `Active ${activeMins}m ${activeSecs}s / 5m`;

            const sleepInSec = Math.max(0, activeWindowMaxSec - elapsedSec);
            const sleepMins = Math.floor(sleepInSec / 60);
            const sleepSecs = sleepInSec % 60;
            if (nextSleepElement) nextSleepElement.innerText = `Sleep in ${sleepMins}m ${sleepSecs}s`;
            if (countdownElement) countdownElement.innerText = `Sleep in ${sleepMins}m ${sleepSecs}s`;
        } else {
            if (activeTimerElement) activeTimerElement.innerText = "In Deep Sleep";
            const wakeInSec = Math.max(0, sleepIntervalSec - elapsedSec);
            const wakeMins = Math.floor(wakeInSec / 60);
            const wakeSecs = wakeInSec % 60;
            if (nextSleepElement) nextSleepElement.innerText = `Wake in ${wakeMins}m ${wakeSecs}s`;
            if (countdownElement) countdownElement.innerText = `Wake in ${wakeMins}m ${wakeSecs}s`;
        }
}

function initMap() {
    const initialLat = 10.8087;
    const initialLon = 76.7402;

    map = L.map('map', {
        zoomControl: false
    }).setView([initialLat, initialLon], 17);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    currentTileLayer = L.tileLayer(mapLayers.google_roadmap, {
        attribution: '&copy; Google Maps',
        maxZoom: 20
    }).addTo(map);

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

    polyline = L.polyline([], {
        color: '#0284C7',
        weight: 5,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(map);
}

function initControls() {
    document.getElementById("btnCenterMap").addEventListener("click", centerMap);
    document.getElementById("btnClearTrail").addEventListener("click", clearTrail);
    document.getElementById("mapTypeSelect").addEventListener("change", changeMapLayer);
    
    document.getElementById("btnDownloadCSV").addEventListener("click", exportCSV);
    document.getElementById("btnViewHistoryMap").addEventListener("click", openHistoryModal);
    document.getElementById("btnCloseHistoryModal").addEventListener("click", closeHistoryModal);
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
            cachedHistoryData = json.data;
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
        setSystemOffline();
    }
}function setSystemOffline() {
    const powerChip = document.getElementById("systemPowerChip");
    powerChip.className = "system-power-chip unpowered";
    document.getElementById("powerText").innerText = "PARKED / DEEP SLEEP";

    const motionBadge = document.getElementById("motionStatusBadge");
    motionBadge.className = "motion-chip parked";
    motionBadge.innerText = "PARKED SLEEP";

    document.getElementById("fixModeBadge").innerText = "Sleep Mode (RF Standby)";
    document.getElementById("fixModeBadge").style.color = "#F59E0B";
    document.getElementById("netStatusVal").innerText = "Standby (Low Power)";
    document.getElementById("netStatusVal").className = "text-warning";
    document.getElementById("gpsModuleState").innerText = "GNSS Tracking Active";
    document.getElementById("gpsModuleState").className = "text-green";
    document.getElementById("speedVal").innerText = "0.0";
}

function updateDashboard(data) {
    const isOnline = (data.online !== false);
    latestOnlineState = isOnline;

    if (data.created_at_iso) {
        lastKnownPacketTimeMs = new Date(data.created_at_iso).getTime();
    } else if (data.created_at) {
        lastKnownPacketTimeMs = new Date(data.created_at.replace(" ", "T") + "Z").getTime();
    }

    // 1. Prominent System Power & Online Status
    const powerChip = document.getElementById("systemPowerChip");
    if (isOnline) {
        powerChip.className = "system-power-chip";
        document.getElementById("powerText").innerText = "SYSTEM POWERED & ONLINE";
    } else {
        setSystemOffline();
    }

    // Format Last Packet Time
    if (lastKnownPacketTimeMs) {
        const lastPacketElement = document.getElementById("lastPacketTimeVal");
        if (lastPacketElement) {
            lastPacketElement.innerText = new Date(lastKnownPacketTimeMs).toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
    }  // 2. Battery & Signal CSQ Status (GPIO 34 ADC Voltage Divider)
    const bat = (data.battery !== undefined && data.battery !== null) ? data.battery : 4.2;
    const batElement = document.getElementById("batteryVal");
    batElement.innerText = `${bat.toFixed(2)}V`;
    if (bat < 3.40) {
        batElement.style.color = "#EF4444";
        batElement.innerText = `${bat.toFixed(2)}V (CRITICAL LOW)`;
    } else if (bat < 3.65) {
        batElement.style.color = "#F59E0B";
    } else {
        batElement.style.color = "#10B981";
    }
    
    const rssi = data.rssi || 0;
    let signalText = `${rssi} CSQ`;
    if (rssi >= 20) signalText += " (Excellent)";
    else if (rssi >= 12) signalText += " (Good)";
    else if (rssi > 0) signalText += " (Fair)";
    else signalText = "No Signal";

    document.getElementById("rssiVal").innerText = signalText;
    document.getElementById("simCarrierVal").innerText = "Airtel 4G (airtelgprs.com)";
    document.getElementById("netStatusVal").innerText = "Registered (4G LTE)";
    document.getElementById("netStatusVal").className = "text-green";

    latestOnlineState = isOnline;
    if (data.created_at_iso) {
        lastKnownPacketTimeMs = new Date(data.created_at_iso).getTime();
    } else if (data.created_at) {
        lastKnownPacketTimeMs = new Date(data.created_at.replace(" ", "T") + "Z").getTime();
    }

    // Format Last Packet Time
    if (lastKnownPacketTimeMs) {
        const lastPacketElement = document.getElementById("lastPacketTimeVal");
        if (lastPacketElement) {
            lastPacketElement.innerText = new Date(lastKnownPacketTimeMs).toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
    }

    // 3. GNSS / GPS Hardware Status
    const sats = data.satellites || 0;
    const hdop = data.hdop || 1.0;
    const fixMode = data.fix_mode !== undefined ? data.fix_mode : (data.fix_valid ? 3 : 0);
    const fixBadge = document.getElementById("fixModeBadge");

    document.getElementById("gpsModuleState").innerText = "Active & Enabled";
    document.getElementById("gpsModuleState").className = "text-green";
    document.getElementById("satellitesVal").innerText = `${sats} Satellites`;

    const isQualityFix = (fixMode >= 3 && sats >= MIN_REQUIRED_SATELLITES && hdop <= MAX_ALLOWED_HDOP);

    if (fixMode === 9) { // FixMode 9 = Emergency Low Battery Death Flag
        fixBadge.innerText = "BATTERY CRITICAL SHUTDOWN";
        fixBadge.style.color = "#EF4444";
    } else if (fixMode === 4) {
        fixBadge.innerText = "DGPS Sub-Meter";
        fixBadge.style.color = "#0284C7";
    } else if (isQualityFix) {
        fixBadge.innerText = `3D GNSS LOCK (HDOP: ${hdop.toFixed(1)})`;
        fixBadge.style.color = "#10B981";
    } else if (sats >= 4 && sats < MIN_REQUIRED_SATELLITES) {
        fixBadge.innerText = `2D Fix (Low Acc)`;
        fixBadge.style.color = "#F59E0B";
    } else {
        fixBadge.innerText = sats > 0 ? `Searching Fix (${sats} Sats)` : "Searching Satellites...";
        fixBadge.style.color = "#F59E0B";
    }

    // 4. Position & Speed
    const lat = data.latitude || 0.0;
    const lon = data.longitude || 0.0;
    const alt = data.altitude || 0.0;
    let rawSpeed = data.speed || 0.0;

    document.getElementById("latVal").innerText = `${lat.toFixed(6)}°`;
    document.getElementById("lonVal").innerText = `${lon.toFixed(6)}°`;
    document.getElementById("altVal").innerText = `${alt.toFixed(1)} m`;

    const motionBadge = document.getElementById("motionStatusBadge");

    if (!isQualityFix) {
        motionBadge.className = "motion-chip parked";
        motionBadge.innerText = "SEARCHING FIX";
        document.getElementById("speedVal").innerText = "0.0";
    } else {
        let displaySpeed = rawSpeed >= SPEED_THRESHOLD_KMH ? rawSpeed : 0.0;
        document.getElementById("speedVal").innerText = displaySpeed.toFixed(1);

        if (displaySpeed >= SPEED_THRESHOLD_KMH) {
            motionBadge.className = "motion-chip moving";
            motionBadge.innerText = "MOVING";
        } else {
            motionBadge.className = "motion-chip parked";
            motionBadge.innerText = "PARKED";
        }
    }

    // 5. Map Anchor & Route Polyline
    if (lat !== 0 && lon !== 0 && fixMode >= 2) {
        const currentPos = [lat, lon];

        if (anchorLat !== null && anchorLon !== null) {
            const displacement = haversineDistance(anchorLat, anchorLon, lat, lon);

            if (displacement < DISPLACEMENT_THRESHOLD_METERS || !isQualityFix || (rawSpeed < SPEED_THRESHOLD_KMH)) {
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
                Fix: ${fixBadge.innerText}
            </div>
        `);
    }
}

// Export Telemetry Logs to CSV File (Direct Database Download)
function exportCSV() {
    window.location.href = '/api/v1/telemetry/export-csv';
}

// Dedicated History Route Map Modal Functions
function openHistoryModal() {
    const modal = document.getElementById("historyModal");
    modal.classList.add("active");

    if (!historyMap) {
        historyMap = L.map('historyMap', { zoomControl: true }).setView([10.8087, 76.7402], 17);
        historyTileLayer = L.tileLayer(mapLayers.google_roadmap, { attribution: '&copy; Google Maps', maxZoom: 20 }).addTo(historyMap);
        historyPolyline = L.polyline([], { color: '#2563EB', weight: 5, opacity: 0.9 }).addTo(historyMap);
    }

    setTimeout(() => {
        historyMap.invalidateSize();
        renderHistoryModalData();
    }, 200);
}

function closeHistoryModal() {
    document.getElementById("historyModal").classList.remove("active");
}

function renderHistoryModalData() {
    if (!cachedHistoryData || cachedHistoryData.length === 0) return;

    let hCoords = [];
    let maxSpeed = 0.0;
    let hDistance = 0.0;
    let hAnchorLat = null;
    let hAnchorLon = null;

    cachedHistoryData.forEach(item => {
        const lat = item.latitude;
        const lon = item.longitude;
        const speed = item.speed || 0.0;

        if (speed > maxSpeed) maxSpeed = speed;

        if (lat && lon && lat !== 0 && lon !== 0) {
            if (hAnchorLat !== null && hAnchorLon !== null) {
                const dist = haversineDistance(hAnchorLat, hAnchorLon, lat, lon);
                if (dist >= DISPLACEMENT_THRESHOLD_METERS && dist < 500) {
                    hDistance += dist;
                    hCoords.push([lat, lon]);
                    hAnchorLat = lat;
                    hAnchorLon = lon;
                }
            } else {
                hAnchorLat = lat;
                hAnchorLon = lon;
                hCoords.push([lat, lon]);
            }
        }
    });

    document.getElementById("hPointsVal").innerText = cachedHistoryData.length;
    document.getElementById("hMaxSpeedVal").innerText = `${maxSpeed.toFixed(1)} km/h`;
    document.getElementById("hDistanceVal").innerText = `${hDistance.toFixed(1)} m`;

    historyPolyline.setLatLngs(hCoords);

    if (hCoords.length > 0) {
        if (historyStartMarker) historyMap.removeLayer(historyStartMarker);
        if (historyEndMarker) historyMap.removeLayer(historyEndMarker);

        const startPos = hCoords[0];
        const endPos = hCoords[hCoords.length - 1];

        historyStartMarker = L.marker(startPos).addTo(historyMap).bindPopup("<b>Trip Origin</b>");
        historyEndMarker = L.marker(endPos).addTo(historyMap).bindPopup("<b>Trip End / Current Position</b>");

        const bounds = L.latLngBounds(hCoords);
        historyMap.fitBounds(bounds, { padding: [40, 40] });
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
        cachedHistoryData = [];
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
