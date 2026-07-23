#ifndef TYPES_H
#define TYPES_H

#include <Arduino.h>

// GPS / GNSS Data structure
struct GPSData {
    bool valid = false;          // True if valid 2D/3D fix is obtained
    double latitude = 0.0;       // Decimal degrees (+ North, - South)
    double longitude = 0.0;      // Decimal degrees (+ East, - West)
    float altitude = 0.0;        // Altitude in meters
    float speed = 0.0;           // Speed in km/h
    float heading = 0.0;         // Course over ground in degrees (0..360)
    float hdop = 0.0;            // Horizontal Dilution of Precision
    int satellites = 0;          // Number of active satellites
    String utc = "";             // ISO / UTC timestamp string
};

// Tracker State Machine states
enum class TrackerState {
    BOOT,
    CHECK_SIM,
    WAIT_NETWORK,
    ENABLE_GPS,
    WAIT_GPS_FIX,
    TRACK,
    UPLOAD,
    ERROR_STATE
};

// Convert state to readable string
inline String stateToString(TrackerState state) {
    switch (state) {
        case TrackerState::BOOT:         return "BOOT";
        case TrackerState::CHECK_SIM:    return "CHECK_SIM";
        case TrackerState::WAIT_NETWORK: return "WAIT_NETWORK";
        case TrackerState::ENABLE_GPS:   return "ENABLE_GPS";
        case TrackerState::WAIT_GPS_FIX: return "WAIT_GPS_FIX";
        case TrackerState::TRACK:        return "TRACK";
        case TrackerState::UPLOAD:       return "UPLOAD";
        case TrackerState::ERROR_STATE:  return "ERROR_STATE";
        default:                         return "UNKNOWN";
    }
}

// Telemetry payload structure
struct TelemetryData {
    String deviceId;
    String timestamp;
    GPSData gps;
    int signalRssi;              // RSSI value (CSQ 0..31, 99=Unknown)
    float batteryVoltage;        // System battery voltage
    TrackerState state;
};

#endif // TYPES_H
