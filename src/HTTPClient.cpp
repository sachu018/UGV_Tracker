#include "HTTPClient.h"
#include "Config.h"

TrackerHTTPClient::TrackerHTTPClient(EC200U &modem) : _modem(modem) {}

String TrackerHTTPClient::createTelemetryJSON(const TelemetryData &data) {
    StaticJsonDocument<512> doc;

    doc["device_id"] = data.deviceId;
    doc["timestamp"] = data.timestamp.length() > 0 ? data.timestamp : data.gps.utc;
    doc["latitude"]  = data.gps.latitude;
    doc["longitude"] = data.gps.longitude;
    doc["altitude"]  = data.gps.altitude;
    doc["speed"]     = data.gps.speed;
    doc["heading"]   = data.gps.heading;
    doc["hdop"]      = data.gps.hdop;
    doc["satellites"]= data.gps.satellites;
    doc["fix_valid"] = data.gps.valid;
    doc["rssi"]      = data.signalRssi;
    doc["battery"]   = data.batteryVoltage;
    doc["state"]     = stateToString(data.state);

    String payload;
    serializeJson(doc, payload);
    return payload;
}

bool TrackerHTTPClient::sendTelemetry(const String &url, const TelemetryData &data, int &httpCode) {
    String payload = createTelemetryJSON(data);
    LOG_INFO("Payload: " + payload);
    String responseBody;
    return _modem.postHTTP(url, payload, httpCode, responseBody);
}
