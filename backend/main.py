from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import sys

# Ensure backend directory is in sys.path for cloud deployment
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import database

app = FastAPI(title="UGV Standalone GPS Tracker Backend", version="1.0.0")

# Enable CORS for web dashboard access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize SQLite Database on startup
database.init_db()

# Mount Static Files (Dashboard HTML/CSS/JS)
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/", response_class=HTMLResponse)
async def read_index():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>UGV Tracker Backend Running</h1>"

# 1. Telemetry Ingestion via JSON POST (ESP32)
@app.post("/api/v1/telemetry")
async def receive_post_telemetry(request: Request):
    try:
        data = await request.json()
        database.save_telemetry(data)
        return {"status": "success", "message": "Telemetry received"}
    except Exception as e:
        return JSONResponse(status_code=400, content={"status": "error", "detail": str(e)})

# 2. Telemetry Ingestion via HTTP GET (ThingSpeak style / query params)
@app.get("/api/v1/telemetry/update")
async def receive_get_telemetry(
    field1: float = 0.0, # Latitude
    field2: float = 0.0, # Longitude
    field3: float = 0.0, # Speed
    field4: int = 0,     # Satellites
    field5: float = 0.0, # Altitude
    field6: int = 0,     # RSSI
    field7: float = 4.2, # Battery
    field8: int = 3,     # Fix Mode (0=No Fix, 2=2D, 3=3D, 4=DGPS)
    device_id: str = "UGV-TRACKER-01"
):
    # Server-Side Stationary Drift Noise Filter
    clean_speed = field3
    if field3 < 2.5 or field4 < 5 or field8 < 2:
        clean_speed = 0.0

    data = {
        "device_id": device_id,
        "latitude": field1,
        "longitude": field2,
        "speed": clean_speed,
        "satellites": field4,
        "altitude": field5,
        "rssi": field6,
        "battery": field7,
        "fix_mode": field8,
        "fix_valid": True if field1 != 0 and field2 != 0 and field8 >= 2 else False
    }
    database.save_telemetry(data)
    return {"status": "success", "message": "Telemetry updated"}

from datetime import datetime, timezone

# 3. Latest Telemetry Endpoint (Web Dashboard Polling with 45s Heartbeat Check)
@app.get("/api/v1/telemetry/latest")
async def get_latest():
    latest = database.get_latest_telemetry()
    if latest:
        # Check timestamp freshness (Heartbeat timeout = 45 seconds)
        is_online = True
        try:
            created_at_str = latest.get("created_at")
            if created_at_str:
                # Parse created_at format: YYYY-MM-DD HH:MM:SS
                record_time = datetime.strptime(created_at_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
                now_time = datetime.now(timezone.utc)
                age_seconds = (now_time - record_time).total_seconds()
                if age_seconds > 45:
                    is_online = False
        except Exception:
            pass

        # Copy data and apply offline overrides if hardware is off
        latest_data = dict(latest)
        latest_data["online"] = is_online
        if not is_online:
            latest_data["speed"] = 0.0
            latest_data["fix_valid"] = False
            latest_data["fix_mode"] = 0

        return {"status": "success", "data": latest_data}
    return {"status": "empty", "data": None}

# 4. Telemetry History Endpoint (Trail Line on Map)
@app.get("/api/v1/telemetry/history")
async def get_history(limit: int = 100):
    history = database.get_history_telemetry(limit)
    return {"status": "success", "count": len(history), "data": history}

# 5. Clear Database History
@app.post("/api/v1/telemetry/reset")
async def reset_history():
    database.clear_telemetry()
    return {"status": "success", "message": "Telemetry history cleared"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
