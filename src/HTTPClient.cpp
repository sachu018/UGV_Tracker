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

bool TrackerHTTPClient::sendToThingSpeak(const String &baseUrl, const String &apiKey, const TelemetryData &data, int &httpCode) {
    if (apiKey == "YOUR_THINGSPEAK_WRITE_API_KEY" || apiKey.length() == 0) {
        LOG_ERROR("ThingSpeak API Key not configured! Please update THINGSPEAK_API_KEY in Config.h");
        httpCode = 400;
        return false;
    }

    String url = baseUrl + "?api_key=" + apiKey +
                 "&field1=" + String(data.gps.latitude, 6) +
                 "&field2=" + String(data.gps.longitude, 6) +
                 "&field3=" + String(data.gps.speed, 2) +
                 "&field4=" + String(data.gps.satellites) +
                 "&field5=" + String(data.gps.altitude, 1) +
                 "&field6=" + String(data.signalRssi) +
                 "&field7=" + String(data.batteryVoltage, 2);

    LOG_INFO("Uploading to ThingSpeak Cloud...");
    String resp;
    return _modem.getHTTP(url, httpCode, resp);
}
