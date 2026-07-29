#include "GPS.h"
#include "Config.h"

GPS::GPS(EC200U &modem) : _modem(modem), _lastUpdateMs(0) {}

bool GPS::begin() {
    LOG_INFO("Initializing GPS module...");
    return _modem.enableGPS();
}

bool GPS::update() {
    uint32_t now = millis();
    if (now - _lastUpdateMs >= GPS_POLL_INTERVAL_MS) {
        _lastUpdateMs = now;
        return _modem.getLocation(_currentData);
    }
    return _currentData.valid;
}

bool GPS::hasFix() const {
    return _currentData.valid;
}

const GPSData& GPS::getData() const {
    return _currentData;
}

void GPS::printDebug() const {
    String fixModeStr = "No Fix";
    if (_currentData.fixMode == 2) fixModeStr = "2D Fix";
    else if (_currentData.fixMode == 3) fixModeStr = "3D GNSS";
    else if (_currentData.fixMode == 4) fixModeStr = "DGPS";

    if (_currentData.valid) {
        DEBUG_SERIAL.printf("[GPS] FIX OK (%s) | Satellites: %d | Lat: %.6f, Lon: %.6f | Alt: %.1fm | Speed: %.1f km/h | HDOP: %.1f | Time: %s\n",
            fixModeStr.c_str(),
            _currentData.satellites,
            _currentData.latitude,
            _currentData.longitude,
            _currentData.altitude,
            _currentData.speed,
            _currentData.hdop,
            _currentData.utc.c_str()
        );
    } else {
        DEBUG_SERIAL.printf("[GPS] SEARCHING... | Satellites Captured: %d | Fix Level: %s (Mode %d) | HDOP: %.1f | Time: %s\n",
            _currentData.satellites,
            fixModeStr.c_str(),
            _currentData.fixMode,
            _currentData.hdop,
            _currentData.utc.c_str()
        );
    }
}
