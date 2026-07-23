#ifndef HTTPCLIENT_H
#define HTTPCLIENT_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include "EC200U.h"
#include "Types.h"

class TrackerHTTPClient {
public:
    explicit TrackerHTTPClient(EC200U &modem);

    bool sendTelemetry(const String &url, const TelemetryData &data, int &httpCode);
    String createTelemetryJSON(const TelemetryData &data);

private:
    EC200U &_modem;
};

#endif // HTTPCLIENT_H
