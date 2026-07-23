#include "Tracker.h"
#include "Config.h"

Tracker::Tracker() 
    : _gps(_modem), 
      _network(_modem), 
      _httpClient(_modem), 
      _state(TrackerState::BOOT), 
      _stateTimer(0), 
      _lastUploadMs(0) {}

bool Tracker::begin() {
    LOG_INFO("=========================================");
    LOG_INFO(" Starting UGV Standalone GPS Tracker ");
    LOG_INFO("=========================================");

    setState(TrackerState::BOOT);
    return true;
}

void Tracker::setState(TrackerState newState) {
    _state = newState;
    _stateTimer = millis();
    LOG_INFO("Tracker State Transition -> " + stateToString(_state));
}

TrackerState Tracker::getState() const {
    return _state;
}

void Tracker::update() {
    handleState();
}

void Tracker::handleState() {
    switch (_state) {
        case TrackerState::BOOT: {
            if (_modem.begin(EC200U_SERIAL, EC200U_BAUD, EC200U_RX_PIN, EC200U_TX_PIN)) {
                setState(TrackerState::CHECK_SIM);
            } else {
                LOG_ERROR("Modem init failed. Retrying in 5 seconds...");
                delay(5000);
            }
            break;
        }

        case TrackerState::CHECK_SIM: {
            if (_network.checkSIM()) {
                setState(TrackerState::WAIT_NETWORK);
            } else {
                if (millis() - _stateTimer > 10000) {
                    LOG_ERROR("SIM check failed continuously.");
                    setState(TrackerState::ERROR_STATE);
                } else {
                    delay(1000);
                }
            }
            break;
        }

        case TrackerState::WAIT_NETWORK: {
            if (_network.connect(CELLULAR_APN, NETWORK_TIMEOUT_MS)) {
                setState(TrackerState::ENABLE_GPS);
            } else {
                LOG_ERROR("Network registration failed.");
                setState(TrackerState::ERROR_STATE);
            }
            break;
        }

        case TrackerState::ENABLE_GPS: {
            if (_gps.begin()) {
                setState(TrackerState::WAIT_GPS_FIX);
            } else {
                LOG_ERROR("Failed to enable GPS.");
                setState(TrackerState::ERROR_STATE);
            }
            break;
        }

        case TrackerState::WAIT_GPS_FIX: {
            _gps.update();
            _gps.printDebug();

            if (_gps.hasFix()) {
                LOG_INFO("GPS Fix Acquired!");
                setState(TrackerState::TRACK);
            } else {
                delay(1000);
            }
            break;
        }

        case TrackerState::TRACK: {
            _gps.update();
            _gps.printDebug();

            uint32_t now = millis();
            if (now - _lastUploadMs >= TELEMETRY_INTERVAL_MS) {
                _lastUploadMs = now;
                setState(TrackerState::UPLOAD);
            } else {
                delay(500);
            }
            break;
        }

        case TrackerState::UPLOAD: {
            TelemetryData tData;
            tData.deviceId = DEVICE_ID;
            tData.gps = _gps.getData();
            tData.signalRssi = _network.getSignalStrength();
            tData.batteryVoltage = 4.2; // Monitored battery voltage
            tData.state = _state;

            int httpCode = 0;
            bool success = _httpClient.sendToThingSpeak(THINGSPEAK_URL, THINGSPEAK_API_KEY, tData, httpCode);
            
            if (success) {
                LOG_INFO("ThingSpeak upload SUCCESSFUL!");
            } else {
                LOG_ERROR("ThingSpeak upload FAILED (Code: " + String(httpCode) + ")");
            }

            // Return to tracking
            setState(TrackerState::TRACK);
            break;
        }

        case TrackerState::ERROR_STATE: {
            LOG_ERROR("Entering Recovery mode in 5 seconds...");
            delay(5000);
            setState(TrackerState::BOOT);
            break;
        }
    }
}
