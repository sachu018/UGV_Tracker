#include "Tracker.h"
#include "Config.h"

static float readBatteryVoltage() {
    analogSetAttenuation(ADC_11db);
    uint32_t rawSum = 0;
    for (int i = 0; i < 10; i++) {
        rawSum += analogRead(BATTERY_ADC_PIN);
        delay(2);
    }
    float rawAvg = (float)rawSum / 10.0f;
    float pinVoltage = (rawAvg / 4095.0f) * 3.3f;
    float batteryVoltage = pinVoltage * 2.0f; // Voltage divider ratio 2.0 (100k + 100k)
    return batteryVoltage;
}

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
    float bootBat = readBatteryVoltage();
    int bootRssi = _network.getSignalStrength();

    LOG_INFO("=======================================================");
    LOG_INFO(" [BOOT SNAPSHOT] System Initialization & Wakeup Event ");
    LOG_INFO("=======================================================");
    LOG_INFO(" - Battery Voltage : " + String(bootBat, 2) + " V (GPIO 34 ADC)");
    LOG_INFO(" - SIM / Cellular  : Airtel 4G (Signal: " + String(bootRssi) + " CSQ)");
    LOG_INFO(" - GNSS Module     : Active Multi-Constellation");
    LOG_INFO(" - Power Saver Mode: Motion-Aware Deep Sleep Active");
    LOG_INFO("=======================================================");

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
            tData.batteryVoltage = readBatteryVoltage(); // Live GPIO 34 ADC Battery Reading
            tData.state = _state;

            // Emergency Low Battery Death Alert
            if (tData.batteryVoltage < BATTERY_LOW_CUTOFF) {
                LOG_ERROR("[CRITICAL BATTERY] Voltage dropped to " + String(tData.batteryVoltage, 2) + "V!");
                tData.gps.fixMode = 9; // FixMode 9 = Emergency Low Battery Death Flag
            }

            int httpCode1 = 0, httpCode2 = 0;
            String respBody1, respBody2;
            
            String queryParams = "?field1=" + String(tData.gps.latitude, 6) +
                                 "&field2=" + String(tData.gps.longitude, 6) +
                                 "&field3=" + String(tData.gps.speed, 2) +
                                 "&field4=" + String(tData.gps.satellites) +
                                 "&field5=" + String(tData.gps.altitude, 1) +
                                 "&field6=" + String(tData.signalRssi) +
                                 "&field7=" + String(tData.batteryVoltage, 2) +
                                 "&field8=" + String(tData.gps.fixMode) +
                                 "&device_id=" + tData.deviceId +
                                 "&key=" + String(DEVICE_API_KEY);

            // DUAL UPLOAD: 1. Vendor Server
            LOG_INFO("Dual Upload [1/2]: Vendor Backend (" + String(VENDOR_SERVER_URL) + ")");
            bool success1 = _modem.getHTTP(String(VENDOR_SERVER_URL) + queryParams, httpCode1, respBody1);

            // DUAL UPLOAD: 2. Custom Render Cloud Server
            LOG_INFO("Dual Upload [2/2]: Custom Render Cloud (" + String(RENDER_SERVER_URL) + ")");
            bool success2 = _modem.getHTTP(String(RENDER_SERVER_URL) + queryParams, httpCode2, respBody2);
            
            if (success1 && success2) {
                LOG_INFO("DUAL TELEMETRY UPLOAD SUCCESSFUL TO BOTH SERVERS!");
            } else {
                LOG_ERROR("Dual Upload Result -> Vendor: " + String(httpCode1) + " | Render: " + String(httpCode2));
            }

            setState(TrackerState::TRACK);
            break;
        }

        case TrackerState::PARKED_SLEEP: {
            // Continuous Testing Mode: Redirect immediately to TRACK (no Deep Sleep)
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
