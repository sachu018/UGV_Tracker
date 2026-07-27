// UGV FleetTrack — Interactive Telematics, Analytics & Charting System

let map;
let marker;
let polyline;
let currentTileLayer = null;
let pathCoordinates = [];
let totalDistanceMeters = 0.0;

// Strict Indoor & Stationary Noise Hardening Thresholds
let anchorLat = null;
let anchorLon = null;
const DISPLACEMENT_THRESHOLD_METERS = 15.0;
const SPEED_THRESHOLD_KMH = 3.5;
const MAX_ALLOWED_HDOP = 1.8;
const MIN_REQUIRED_SATELLITES = 7;

// Chart.js Instances
let speedChartInstance = null;
let signalChartInstance = null;

// Telemetry History Log Cache
let cachedLogs = [];

const mapLayers = {
    google_roadmap: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    google_hybrid: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    osm: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
};

// Initialize Leaflet Map & Interactive Listeners on Load
document.addEventListener("DOMContentLoaded", () => {
    initMap();
    initUIControls();
    initCharts();
    fetchHistory();
    setInterval(fetchLatestTelemetry, 2000);
});

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

// UI Sizing & Tab Controls
function initUIControls() {
    const sheet = document.getElementById("fleetSheet");
    const btnToggleSize = document.getElementById("btnToggleSize");
    const btnMinimizeSheet = document.getElementById("btnMinimizeSheet");
    const expandIcon = document.getElementById("expandIcon");

    const tabLiveBtn = document.getElementById("tabLiveBtn");
    const tabAnalyticsBtn = document.getElementById("tabAnalyticsBtn");
    const tabLiveContent = document.getElementById("tabLiveContent");
    const tabAnalyticsContent = document.getElementById("tabAnalyticsContent");

    document.getElementById("btnCenterMap").addEventListener("click", centerMap);
    document.getElementById("btnClearTrail").addEventListener("click", clearTrail);
    document.getElementById("mapTypeSelect").addEventListener("change", changeMapLayer);
    document.getElementById("btnExportCSV").addEventListener("click", exportCSV);

    // Maximize / Restore Sheet Toggle
    btnToggleSize.addEventListener("click", () => {
        if (sheet.classList.contains("sheet-maximized")) {
            sheet.classList.remove("sheet-maximized");
            sheet.classList.add("sheet-normal");
            expandIcon.className = "fa-solid fa-expand";
        } else {
            sheet.classList.remove("sheet-minimized", "sheet-normal");
            sheet.classList.add("sheet-maximized");
            expandIcon.className = "fa-solid fa-compress";
        }
    });

    // Minimize Sheet Toggle
    btnMinimizeSheet.addEventListener("click", () => {
        if (sheet.classList.contains("sheet-minimized")) {
            sheet.classList.remove("sheet-minimized");
            sheet.classList.add("sheet-normal");
        } else {
            sheet.classList.remove("sheet-maximized", "sheet-normal");
            sheet.classList.add("sheet-minimized");
            expandIcon.className = "fa-solid fa-expand";
        }
    });

    // Drag Handle Click to Restore
    document.getElementById("sheetDragHandle").addEventListener("click", () => {
        sheet.className = "fleet-bottom-sheet sheet-normal";
        expandIcon.className = "fa-solid fa-expand";
    });

    // Tab Switching
    tabLiveBtn.addEventListener("click", () => {
        tabLiveBtn.classList.add("active");
        tabAnalyticsBtn.classList.remove("active");
        tabLiveContent.classList.add("active");
        tabAnalyticsContent.classList.remove("active");
    });

    tabAnalyticsBtn.addEventListener("click", () => {
        tabAnalyticsBtn.classList.add("active");
        tabLiveBtn.classList.remove("active");
        tabAnalyticsContent.classList.add("active");
        tabLiveContent.classList.remove("active");
        // Automatically maximize sheet when switching to analytics tab for comfortable view
        sheet.className = "fleet-bottom-sheet sheet-maximized";
        expandIcon.className = "fa-solid fa-compress";
        updateChartsAndTable();
    });
}

// Initialize Chart.js Graphs
function initCharts() {
    const ctxSpeed = document.getElementById('speedChart').getContext('2d');
    speedChartInstance = new Chart(ctxSpeed, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Speed (km/h)',
                    data: [],
                    borderColor: '#0284C7',
                    backgroundColor: 'rgba(2, 132, 199, 0.1)',
                    fill: true,
                    tension: 0.3
                },
                {
                    label: 'Altitude (m)',
                    data: [],
                    borderColor: '#10B981',
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                title: { display: true, text: 'Speed & Altitude Profile', font: { size: 12, weight: 'bold' } }
            },
            scales: {
                x: { ticks: { font: { size: 9 } } },
                y: { beginAtZero: true, ticks: { font: { size: 9 } } }
            }
        }
    });

    const ctxSignal = document.getElementById('signalChart').getContext('2d');
    signalChartInstance = new Chart(ctxSignal, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Satellites Locked',
                    data: [],
                    backgroundColor: '#2563EB'
                },
                {
                    label: 'LTE Signal (CSQ)',
                    data: [],
                    backgroundColor: '#F59E0B'
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                title: { display: true, text: 'GNSS Satellites & LTE CSQ Signal', font: { size: 12, weight: 'bold' } }
            },
            scales: {
                x: { ticks: { font: { size: 9 } } },
                y: { beginAtZero: true, ticks: { font: { size: 9 } } }
            }
        }
    });
}

// Fetch historical path & populate cache
async function fetchHistory() {
    try {
        const response = await fetch('/api/v1/telemetry/history?limit=300');
        const json = await response.json();
        if (json.status === 'success' && json.data.length > 0) {
            cachedLogs = json.data;
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

            updateChartsAndTable();
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

    const motionBadge = document.getElementById("motionStatusBadge");
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

// Update Chart.js Data & Telemetry Table
function updateChartsAndTable() {
    if (!cachedLogs || cachedLogs.length === 0) return;

    const labels = [];
    const speedData = [];
    const altData = [];
    const satsData = [];
    const csqData = [];
    const tbody = document.getElementById("logsTableBody");
    let tableHtml = "";

    // Reverse to show newest first in table, oldest to newest in chart
    const logsCopy = [...cachedLogs];
    
    logsCopy.forEach((row, idx) => {
        const timeStr = row.created_at ? row.created_at.split(' ')[1] || row.created_at : `P-${idx}`;
        labels.push(timeStr);
        speedData.push(row.speed || 0.0);
        altData.push(row.altitude || 0.0);
        satsData.push(row.satellites || 0);
        csqData.push(row.rssi || 0);

        let fixStr = "3D Fix";
        if (row.fix_mode === 4) fixStr = "DGPS";
        else if (row.fix_mode === 2) fixStr = "2D Fix";
        else if (row.satellites < MIN_REQUIRED_SATELLITES) fixStr = "Indoor Noise";

        tableHtml = `
            <tr>
                <td>${row.created_at || 'Just now'}</td>
                <td>${row.latitude ? row.latitude.toFixed(5) : 0}, ${row.longitude ? row.longitude.toFixed(5) : 0}</td>
                <td><strong>${(row.speed || 0.0).toFixed(1)}</strong> km/h</td>
                <td>${(row.altitude || 0.0).toFixed(1)} m</td>
                <td>${row.satellites || 0}</td>
                <td>${row.rssi || 0} CSQ</td>
                <td><span style="font-weight:700; color:${fixStr.includes('Indoor')?'#EF4444':'#10B981'}">${fixStr}</span></td>
            </tr>
        ` + tableHtml;
    });

    tbody.innerHTML = tableHtml;

    // Update Speed/Alt Chart
    speedChartInstance.data.labels = labels;
    speedChartInstance.data.datasets[0].data = speedData;
    speedChartInstance.data.datasets[1].data = altData;
    speedChartInstance.update();

    // Update Signal Chart
    signalChartInstance.data.labels = labels;
    signalChartInstance.data.datasets[0].data = satsData;
    signalChartInstance.data.datasets[1].data = csqData;
    signalChartInstance.update();
}

// Export CSV File
function exportCSV() {
    if (!cachedLogs || cachedLogs.length === 0) {
        alert("No telemetry logs available to export.");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,ID,Timestamp,Latitude,Longitude,Altitude,Speed,Heading,HDOP,Satellites,FixMode,RSSI,Battery\n";

    cachedLogs.forEach(row => {
        csvContent += `${row.id},${row.created_at || ''},${row.latitude},${row.longitude},${row.altitude},${row.speed},${row.heading},${row.hdop},${row.satellites},${row.fix_mode},${row.rssi},${row.battery}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `UGV_Telemetry_Logs_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        cachedLogs = [];
        updateChartsAndTable();
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
