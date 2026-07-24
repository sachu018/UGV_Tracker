import sqlite3
import os

DB_FILE = os.path.join(os.path.dirname(__file__), "ugv_tracker.db")

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS telemetry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT,
            timestamp TEXT,
            latitude REAL,
            longitude REAL,
            altitude REAL,
            speed REAL,
            heading REAL,
            hdop REAL,
            satellites INTEGER,
            fix_mode INTEGER DEFAULT 0,
            fix_valid INTEGER,
            rssi INTEGER,
            battery REAL,
            state TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    # Auto-add fix_mode column if upgrading existing database
    try:
        cursor.execute("ALTER TABLE telemetry ADD COLUMN fix_mode INTEGER DEFAULT 0")
    except Exception:
        pass
    conn.commit()
    conn.close()

def save_telemetry(data: dict):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO telemetry (
            device_id, timestamp, latitude, longitude, altitude,
            speed, heading, hdop, satellites, fix_mode, fix_valid, rssi, battery, state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        data.get("device_id", "UGV-TRACKER-01"),
        data.get("timestamp", ""),
        data.get("latitude", 0.0),
        data.get("longitude", 0.0),
        data.get("altitude", 0.0),
        data.get("speed", 0.0),
        data.get("heading", 0.0),
        data.get("hdop", 0.0),
        data.get("satellites", 0),
        data.get("fix_mode", 3 if data.get("fix_valid", True) else 0),
        1 if data.get("fix_valid", True) else 0,
        data.get("rssi", 0),
        data.get("battery", 4.2),
        data.get("state", "TRACK")
    ))
    conn.commit()
    conn.close()

def get_latest_telemetry():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM telemetry ORDER BY id DESC LIMIT 1
    ''')
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None

def get_history_telemetry(limit=100):
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''
        SELECT * FROM telemetry ORDER BY id DESC LIMIT ?
    ''', (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in reversed(rows)]
