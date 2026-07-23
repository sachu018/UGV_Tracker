#ifndef TRACKER_H
#define TRACKER_H

#include <Arduino.h>
#include "EC200U.h"
#include "GPS.h"
#include "Network.h"
#include "HTTPClient.h"
#include "Types.h"

class Tracker {
public:
    Tracker();

    bool begin();
    void update();

    TrackerState getState() const;

private:
    EC200U _modem;
    GPS _gps;
    Network _network;
    TrackerHTTPClient _httpClient;

    TrackerState _state;
    uint32_t _stateTimer;
    uint32_t _lastUploadMs;

    void setState(TrackerState newState);
    void handleState();
};

#endif // TRACKER_H
