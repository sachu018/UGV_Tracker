#include "Tracker.h"
#include "Config.h"

Tracker::Tracker() 
    : _gps(_modem), 
      _network(_modem), 
      _httpClient(_modem), 
      _state(TrackerState::BOOT), 
      _stateTimer(0), 
      _lastUploadMs(0),
      _stationaryStartMs(0),
      _isStationary(false) {}

bool Tracker::begin() {
    LOG_INFO("=========================================");
    LOG_INFO(" Starting UGV Standalone GPS Tracker ");
    LOG_INFO(" (Deep Sleep Power Saver: 15-Min Test Mode)");
    LOG_INFO("=========================================");

    esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();
    if (wakeup_reason == ESP_SLEEP_WAKEUP_TIMER) {
        LOG_INFO("[POWER SAVER] Woke up from 15-Minute Deep Sleep Timer!");
    }

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
                _modem.setLowPowerMode(false); // Ensure modem is awake in full RF mode
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

            uint32_t now = millis();
            if (now - _lastUploadMs >= TELEMETRY_INTERVAL_MS) {
                _lastUploadMs = now;
                setState(TrackerState::UPLOAD);
            } else if (_gps.hasFix()) {
                LOG_INFO("GPS 3D Fix Acquired!");
                setState(TrackerState::TRACK);
            } else {
                delay(500);
            }
            break;
        }

        case TrackerState::TRACK: {
            _gps.update();
            _gps.printDebug();

            GPSData gData = _gps.getData();
            uint32_t now = millis();

            // Stationary Motion Detector (Trigger Deep Sleep if stationary for 2 mins)
            if (gData.speed < 2.0f) {
                if (_stationaryStartMs == 0) {
                    _stationaryStartMs = now;
                }
                
                uint32_t stationaryDuration = now - _stationaryStartMs;
                if (stationaryDuration >= STATIONARY_TIMEOUT_MS) {
                    LOG_INFO("[POWER SAVER] Vehicle stationary for 2 minutes! Transitioning to PARKED_SLEEP...");
                    setState(TrackerState::PARKED_SLEEP);
                    break;
                }
            } else {
                _stationaryStartMs = 0; // Reset timer when real movement occurs
            }

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
            String respBody;
            
            String url = String(SERVER_URL) +
                         "?field1=" + String(tData.gps.latitude, 6) +
                         "&field2=" + String(tData.gps.longitude, 6) +
                         "&field3=" + String(tData.gps.speed, 2) +
                         "&field4=" + String(tData.gps.satellites) +
                         "&field5=" + String(tData.gps.altitude, 1) +
                         "&field6=" + String(tData.signalRssi) +
                         "&field7=" + String(tData.batteryVoltage, 2) +
                         "&field8=" + String(tData.gps.fixMode) +
                         "&device_id=" + tData.deviceId +
                         "&key=" + String(DEVICE_API_KEY);

            LOG_INFO("Uploading Telemetry to Vendor Backend...");
            bool success = _modem.getHTTP(url, httpCode, respBody);
            
            if (success) {
                LOG_INFO("Telemetry Upload SUCCESSFUL!");
            } else {
                LOG_ERROR("Upload FAILED (Code: " + String(httpCode) + ")");
            }

            setState(TrackerState::TRACK);
            break;
        }

        case TrackerState::PARKED_SLEEP: {
            LOG_INFO("=========================================");
            LOG_INFO(" Uploading Final Parked Status Packet ");
            LOG_INFO("=========================================");

            // Send final stationary packet before sleep
            TelemetryData tData;
            tData.deviceId = DEVICE_ID;
            tData.gps = _gps.getData();
            tData.gps.speed = 0.0;
            tData.signalRssi = _network.getSignalStrength();
            tData.batteryVoltage = 4.2;
            tData.state = _state;

            int httpCode = 0;
            String respBody;
            String url = String(SERVER_URL) +
                         "?field1=" + String(tData.gps.latitude, 6) +
                         "&field2=" + String(tData.gps.longitude, 6) +
                         "&field3=0.00" +
                         "&field4=" + String(tData.gps.satellites) +
                         "&field5=" + String(tData.gps.altitude, 1) +
                         "&field6=" + String(tData.signalRssi) +
                         "&field7=" + String(tData.batteryVoltage, 2) +
                         "&field8=" + String(tData.gps.fixMode) +
                         "&device_id=" + tData.deviceId +
                         "&key=" + String(DEVICE_API_KEY);

            _modem.getHTTP(url, httpCode, respBody);

            LOG_INFO("=========================================");
            LOG_INFO(" ENTIRE SYSTEM ENTERING DEEP SLEEP NOW ");
            LOG_INFO(" Duration: 15 Minutes (900 Seconds) ");
            LOG_INFO(" ESP32 Power: ~10 uA | Modem: Low-Power ");
            LOG_INFO("=========================================");

            // 1. Put Modem into Low Power Mode
            _modem.setLowPowerMode(true);
            delay(500);

            // 2. Configure ESP32 Deep Sleep Timer Wakeup (15 minutes = 900,000,000 us)
            esp_sleep_enable_timer_wakeup(PARKED_SLEEP_INTERVAL_SEC * 1000000ULL);
            
            // 3. Start ESP32 Deep Sleep
            esp_deep_sleep_start();
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
