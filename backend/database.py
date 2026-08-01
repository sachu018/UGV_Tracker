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
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT,
            session_start_utc TEXT,
            last_packet_utc TEXT
        )
    ''')
    try:
        cursor.execute("ALTER TABLE telemetry ADD COLUMN fix_mode INTEGER DEFAULT 0")
    except Exception:
        pass
    conn.commit()
    conn.close()

from datetime import datetime, timezone

def save_telemetry(data: dict):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    now_utc_dt = datetime.now(timezone.utc)
    now_utc_str = now_utc_dt.strftime("%Y-%m-%d %H:%M:%S")
    device_id = data.get("device_id", "UGV-TRACKER-01")

    # Check last active transmission session for this device
    cursor.execute("SELECT session_start_utc, last_packet_utc FROM sessions WHERE device_id = ? ORDER BY id DESC LIMIT 1", (device_id,))
    last_sess = cursor.fetchone()

    is_new_session = True
    if last_sess and last_sess[1]:
        try:
            last_pkt_dt = datetime.strptime(last_sess[1], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            gap = (now_utc_dt - last_pkt_dt).total_seconds()
            if gap <= 45: # Continuation of active transmission session
                is_new_session = False
        except Exception:
            pass

    if is_new_session:
        # Record new ESP32 wakeup / transmission session start timestamp
        cursor.execute("INSERT INTO sessions (device_id, session_start_utc, last_packet_utc) VALUES (?, ?, ?)",
                       (device_id, now_utc_str, now_utc_str))
    else:
        # Update last packet timestamp in current session
        cursor.execute("UPDATE sessions SET last_packet_utc = ? WHERE id = (SELECT max(id) FROM sessions WHERE device_id = ?)",
                       (now_utc_str, device_id))

    cursor.execute('''
        INSERT INTO telemetry (
            device_id, timestamp, latitude, longitude, altitude,
            speed, heading, hdop, satellites, fix_mode, fix_valid, rssi, battery, state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        device_id,
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
        data.get("state", "TRACK"),
        now_utc_str
    ))
    conn.commit()
    conn.close()

def get_session_info(device_id="UGV-TRACKER-01"):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT session_start_utc, last_packet_utc FROM sessions WHERE device_id = ? ORDER BY id DESC LIMIT 1", (device_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return {"session_start_utc": row[0], "last_packet_utc": row[1]}
    return None

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

def clear_telemetry():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM telemetry")
    try:
        cursor.execute("DELETE FROM sqlite_sequence WHERE name='telemetry'")
    except Exception:
        pass
    conn.commit()
    conn.close()
