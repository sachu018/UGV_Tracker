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
    if (_currentData.valid) {
        DEBUG_SERIAL.printf("[GPS] FIX OK | Lat: %.6f, Lon: %.6f | Alt: %.1fm | Speed: %.1f km/h | Satellites: %d | Time: %s\n",
            _currentData.latitude,
            _currentData.longitude,
            _currentData.altitude,
            _currentData.speed,
            _currentData.satellites,
            _currentData.utc.c_str()
        );
    } else {
        DEBUG_SERIAL.println("[GPS] Searching for satellites (NO FIX)...");
    }
}
