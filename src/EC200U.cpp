#include "EC200U.h"
#include "Config.h"

EC200U::EC200U() : _serial(nullptr), _isGpsEnabled(false) {}

EC200U::~EC200U() {}

bool EC200U::begin(HardwareSerial &serial, uint32_t baud, int8_t rxPin, int8_t txPin) {
    _serial = &serial;
    _serial->end(); // Close serial if already open from previous init
    _serial->setRxBufferSize(1024); // Expand ESP32 UART RX ring buffer
    _serial->begin(baud, SERIAL_8N1, rxPin, txPin);
    delay(500);

    LOG_INFO("Initializing EC200U modem...");

    // Test AT command responsiveness up to 5 attempts
    bool ok = false;
    for (int i = 0; i < 5; i++) {
        String resp = sendAT("AT", 1000);
        if (resp.indexOf("OK") != -1) {
            ok = true;
            break;
        }
        delay(500);
    }

    if (!ok) {
        LOG_ERROR("EC200U modem not responding to AT commands!");
        return false;
    }

    // Disable command echo for cleaner parsing
    sendAT("ATE0", 1000);
    LOG_INFO("EC200U modem initialized successfully.");
    return true;
}

String EC200U::sendAT(const String &cmd, uint32_t timeoutMs) {
    if (!_serial) return "";

    // Clear buffer
    while (_serial->available()) {
        _serial->read();
    }

    _serial->println(cmd);

    String response = "";
    uint32_t start = millis();

    while (millis() - start < timeoutMs) {
        while (_serial->available()) {
            char c = (char)_serial->read();
            response += c;
        }
    }

    return response;
}

bool EC200U::waitForResponse(const String &expected, uint32_t timeoutMs) {
    if (!_serial) return false;

    uint32_t start = millis();
    String buffer = "";

    while (millis() - start < timeoutMs) {
        while (_serial->available()) {
            char c = (char)_serial->read();
            buffer += c;
            if (buffer.indexOf(expected) != -1) {
                return true;
            }
        }
    }
    return false;
}

bool EC200U::checkSIM() {
    LOG_INFO("Checking SIM card status...");
    String resp = sendAT("AT+CPIN?", 2000);
    if (resp.indexOf("+CPIN: READY") != -1) {
        LOG_INFO("SIM Card is READY.");
        return true;
    } else {
        LOG_ERROR("SIM Card check failed: " + resp);
        return false;
    }
}

bool EC200U::waitForNetwork(uint32_t timeoutMs) {
    LOG_INFO("Waiting for cellular network registration...");
    uint32_t start = millis();

    while (millis() - start < timeoutMs) {
        String resp = sendAT("AT+CREG?", 1000);
        // +CREG: 0,1 (Home) or +CREG: 0,5 (Roaming)
        if (resp.indexOf(",1") != -1 || resp.indexOf(",5") != -1) {
            LOG_INFO("Registered to Cellular Network!");
            return true;
        }

        // Also check LTE EPS registration
        resp = sendAT("AT+CEREG?", 1000);
        if (resp.indexOf(",1") != -1 || resp.indexOf(",5") != -1) {
            LOG_INFO("Registered to LTE EPS Network!");
            return true;
        }

        delay(1000);
    }

    LOG_ERROR("Cellular network registration timeout.");
    return false;
}

int EC200U::getSignalStrength() {
    String resp = sendAT("AT+CSQ", 1000);
    // Response format: +CSQ: <rssi>,<ber>
    int csqIndex = resp.indexOf("+CSQ:");
    if (csqIndex != -1) {
        String sub = resp.substring(csqIndex + 5);
        int commaIndex = sub.indexOf(',');
        if (commaIndex != -1) {
            String rssiStr = sub.substring(0, commaIndex);
            rssiStr.trim();
            return rssiStr.toInt();
        }
    }
    return 99; // 99 = Not known or not detectable
}

bool EC200U::enableGPS() {
    LOG_INFO("Enabling EC200U GNSS/GPS...");
    String resp = sendAT("AT+QGPS=1", 2000);
    
    // CME ERROR 504 means GNSS is already turned on
    if (resp.indexOf("OK") != -1 || resp.indexOf("504") != -1) {
        _isGpsEnabled = true;
        LOG_INFO("GPS enabled.");
        return true;
    }

    LOG_ERROR("Failed to enable GPS: " + resp);
    return false;
}

bool EC200U::disableGPS() {
    LOG_INFO("Disabling EC200U GNSS/GPS...");
    String resp = sendAT("AT+QGPSEND", 2000);
    if (resp.indexOf("OK") != -1) {
        _isGpsEnabled = false;
        LOG_INFO("GPS disabled.");
        return true;
    }
    return false;
}

bool EC200U::getLocation(GPSData &gpsData) {
    if (!_isGpsEnabled) {
        enableGPS();
    }

    String resp = sendAT("AT+QGPSLOC=0", 2000);
    // Example output: +QGPSLOC: 084803.00,19.0760,72.8777,1.0,15.2,3,0.0,0.0,0.0,230726,08
    if (resp.indexOf("+QGPSLOC:") != -1) {
        return parseQGPSLOC(resp, gpsData);
    }
    
    gpsData.valid = false;
    return false;
}

double EC200U::convertNMEAToDecimal(const String &nmeaPos, char direction) {
    if (nmeaPos.length() == 0) return 0.0;
    
    // If string is already in decimal degrees (e.g. 19.0760)
    int dotIndex = nmeaPos.indexOf('.');
    if (dotIndex != -1 && dotIndex <= 3) {
        double val = nmeaPos.toDouble();
        if (direction == 'S' || direction == 'W') val = -val;
        return val;
    }

    // NMEA format: ddmm.mmmm (Lat) or dddmm.mmmm (Lon)
    double raw = nmeaPos.toDouble();
    int dd = (int)(raw / 100);
    double mm = raw - (dd * 100);
    double decimal = dd + (mm / 60.0);

    if (direction == 'S' || direction == 'W') {
        decimal = -decimal;
    }
    return decimal;
}

bool EC200U::parseQGPSLOC(const String &rawResponse, GPSData &gpsData) {
    int locIdx = rawResponse.indexOf("+QGPSLOC:");
    if (locIdx == -1) {
        gpsData.valid = false;
        return false;
    }

    String dataStr = rawResponse.substring(locIdx + 9);
    dataStr.trim();

    // Split by commas
    // Parameters: <UTC>,<lat>,<lon>,<hdop>,<altitude>,<fix>,<cog>,<spkm>,<spknt>,<date>,<nsat>
    int tokensCount = 0;
    String tokens[12];

    int start = 0;
    for (int i = 0; i < dataStr.length(); i++) {
        if (dataStr.charAt(i) == ',' || dataStr.charAt(i) == '\r' || dataStr.charAt(i) == '\n') {
            if (tokensCount < 12) {
                tokens[tokensCount++] = dataStr.substring(start, i);
            }
            start = i + 1;
            if (dataStr.charAt(i) == '\r' || dataStr.charAt(i) == '\n') break;
        }
    }
    if (start < dataStr.length() && tokensCount < 12) {
        tokens[tokensCount++] = dataStr.substring(start);
    }

    if (tokensCount < 11) {
        gpsData.valid = false;
        return false;
    }

    String utcTime = tokens[0];
    String latStr  = tokens[1];
    String lonStr  = tokens[2];
    String hdopStr = tokens[3];
    String altStr  = tokens[4];
    String fixStr  = tokens[5];
    String cogStr  = tokens[6];
    String spkStr  = tokens[7];
    String dateStr = tokens[9];
    String satStr  = tokens[10];

    int fixMode = fixStr.toInt();
    gpsData.fixMode = fixMode;
    if (fixMode >= 2) {
        gpsData.valid = true;
    } else {
        gpsData.valid = false;
    }

    // Check directions in lat/lon strings if present
    char latDir = 'N';
    if (latStr.endsWith("S")) { latDir = 'S'; latStr.remove(latStr.length() - 1); }
    else if (latStr.endsWith("N")) { latDir = 'N'; latStr.remove(latStr.length() - 1); }

    char lonDir = 'E';
    if (lonStr.endsWith("W")) { lonDir = 'W'; lonStr.remove(lonStr.length() - 1); }
    else if (lonStr.endsWith("E")) { lonDir = 'E'; lonStr.remove(lonStr.length() - 1); }

    gpsData.latitude   = convertNMEAToDecimal(latStr, latDir);
    gpsData.longitude  = convertNMEAToDecimal(lonStr, lonDir);
    gpsData.hdop       = hdopStr.toFloat();
    gpsData.altitude   = altStr.toFloat();
    gpsData.heading    = cogStr.toFloat();
    gpsData.satellites = satStr.toInt();

    // Noise Filter: If reported speed is under 2.0 km/h or HDOP is high (> 2.5), treat speed as 0.0 km/h
    float rawSpeed = spkStr.toFloat();
    if (rawSpeed < 2.0f || gpsData.hdop > 2.5f || gpsData.satellites < 5) {
        gpsData.speed = 0.0f;
    } else {
        gpsData.speed = rawSpeed;
    }

    // Format UTC timestamp string: YYYY-MM-DD HH:MM:SS
    if (dateStr.length() == 6 && utcTime.length() >= 6) {
        String dd = dateStr.substring(0, 2);
        String mm = dateStr.substring(2, 4);
        String yy = "20" + dateStr.substring(4, 6);
        String hh = utcTime.substring(0, 2);
        String mi = utcTime.substring(2, 4);
        String ss = utcTime.substring(4, 6);
        gpsData.utc = yy + "-" + mm + "-" + dd + " " + hh + ":" + mi + ":" + ss;
    } else {
        gpsData.utc = dateStr + " " + utcTime;
    }

    return gpsData.valid;
}

bool EC200U::activatePDPContext(const String &apn) {
    LOG_INFO("Configuring APN: " + apn);
    
    // Check if PDP context is already active
    String checkResp = sendAT("AT+QIACT?", 2000);
    if (checkResp.indexOf("+QIACT: 1,1") != -1) {
        LOG_INFO("PDP context is already active!");
        return true;
    }

    // Deactivate context 1 first to ensure a clean state
    sendAT("AT+QIDEACT=1", 3000);

    // Set APN PDP context 1
    sendAT("AT+QICSGP=1,1,\"" + apn + "\",\"\",\"\",1", 2000);

    // Configure Google Public DNS for reliable DNS resolution over LTE
    sendAT("AT+QIDNSCFG=1,\"8.8.8.8\",\"8.8.4.4\"", 2000);
    
    LOG_INFO("Activating PDP context...");
    String resp = sendAT("AT+QIACT=1", 15000);
    if (resp.indexOf("OK") != -1) {
        LOG_INFO("PDP context activated successfully.");
        return true;
    }

    // Verify context activation again in case response output timed out
    checkResp = sendAT("AT+QIACT?", 2000);
    if (checkResp.indexOf("+QIACT: 1,1") != -1) {
        LOG_INFO("PDP context verified active!");
        return true;
    }

    LOG_ERROR("PDP context activation failed: " + resp);
    return false;
}

bool EC200U::postHTTP(const String &url, const String &jsonPayload, int &httpCode, String &responseBody) {
    LOG_INFO("Posting Telemetry to URL: " + url);

    // Set PDP context for HTTP operations
    sendAT("AT+QHTTPCFG=\"contextid\",1", 1000);
    sendAT("AT+QHTTPCFG=\"requestheader\",0", 1000);

    if (url.startsWith("https://")) {
        sendAT("AT+QSSLCFG=\"sslversion\",1,4", 1000);
        sendAT("AT+QSSLCFG=\"seclevel\",1,0", 1000);
        sendAT("AT+QSSLCFG=\"sni\",1,1", 1000);
        sendAT("AT+QSSLCFG=\"ciphersuite\",1,0xFFFF", 1000);
        sendAT("AT+QHTTPCFG=\"sslctxid\",1", 1000);
    } else {
        sendAT("AT+QHTTPCFG=\"sslctxid\",0", 1000);
    }

    // Clear buffer before sending command
    while (_serial->available()) _serial->read();

    // 1. Set URL length
    String cmdUrl = "AT+QHTTPURL=" + String(url.length()) + ",80";
    _serial->println(cmdUrl);
    if (!waitForResponse("CONNECT", 5000)) {
        LOG_ERROR("Failed to enter HTTP URL connect mode");
        while (_serial->available()) _serial->read();
        return false;
    }

    // Write URL string
    _serial->print(url);
    if (!waitForResponse("OK", 5000)) {
        LOG_ERROR("Failed to set HTTP URL");
        while (_serial->available()) _serial->read();
        return false;
    }

    // 2. Post JSON payload
    String cmdPost = "AT+QHTTPPOST=" + String(jsonPayload.length()) + ",80,80";
    _serial->println(cmdPost);
    if (!waitForResponse("CONNECT", 5000)) {
        LOG_ERROR("Failed to enter HTTP POST connect mode");
        while (_serial->available()) _serial->read();
        return false;
    }

    // Write JSON string
    _serial->print(jsonPayload);
    
    // Wait for +QHTTPPOST response URC
    uint32_t start = millis();
    String urcResp = "";
    bool postOk = false;
    
    while (millis() - start < 15000) {
        while (_serial->available()) {
            char c = (char)_serial->read();
            urcResp += c;
            int tagIdx = urcResp.indexOf("+QHTTPPOST:");
            if (tagIdx != -1 && urcResp.indexOf('\n', tagIdx) != -1) {
                postOk = true;
                break;
            }
        }
        if (postOk) break;
    }

    if (!postOk) {
        LOG_ERROR("HTTP POST timeout or failed.");
        while (_serial->available()) _serial->read();
        return false;
    }

    // Parse HTTP Response code from +QHTTPPOST: <err>,<httprspcode>,<contentlen>
    int qIdx = urcResp.indexOf("+QHTTPPOST:");
    if (qIdx != -1) {
        String sub = urcResp.substring(qIdx + 11);
        int comma1 = sub.indexOf(',');
        if (comma1 != -1) {
            int comma2 = sub.indexOf(',', comma1 + 1);
            if (comma2 != -1) {
                String codeStr = sub.substring(comma1 + 1, comma2);
                httpCode = codeStr.toInt();
            }
        }
    }

    LOG_INFO("HTTP Response Code: " + String(httpCode));

    // 3. Read HTTP Response Body
    sendAT("AT+QHTTPREAD=80", 5000);
    return (httpCode == 200 || httpCode == 201);
}

bool EC200U::getHTTP(const String &url, int &httpCode, String &responseBody) {
    LOG_INFO("GET Request URL: " + url);

    sendAT("AT+QHTTPCFG=\"contextid\",1", 1000);
    sendAT("AT+QHTTPCFG=\"responseheader\",0", 1000);

    if (url.startsWith("https://")) {
        sendAT("AT+QSSLCFG=\"sslversion\",1,4", 1000);
        sendAT("AT+QSSLCFG=\"seclevel\",1,0", 1000);
        sendAT("AT+QSSLCFG=\"sni\",1,1", 1000); // Enable Server Name Indication (SNI) for Cloudflare/Render SSL
        sendAT("AT+QSSLCFG=\"ciphersuite\",1,0xFFFF", 1000);
        sendAT("AT+QHTTPCFG=\"sslctxid\",1", 1000);
    } else {
        sendAT("AT+QHTTPCFG=\"sslctxid\",0", 1000);
    }

    while (_serial->available()) _serial->read();

    // 1. Set URL
    String cmdUrl = "AT+QHTTPURL=" + String(url.length()) + ",80";
    _serial->println(cmdUrl);
    if (!waitForResponse("CONNECT", 5000)) {
        LOG_ERROR("Failed to enter HTTP URL connect mode");
        while (_serial->available()) _serial->read();
        return false;
    }

    _serial->print(url);
    if (!waitForResponse("OK", 5000)) {
        LOG_ERROR("Failed to set HTTP URL");
        while (_serial->available()) _serial->read();
        return false;
    }

    // 2. Perform GET
    _serial->println("AT+QHTTPGET=80");
    
    uint32_t start = millis();
    String urcResp = "";
    bool getOk = false;

    while (millis() - start < 20000) {
        while (_serial->available()) {
            char c = (char)_serial->read();
            urcResp += c;
            int tagIdx = urcResp.indexOf("+QHTTPGET:");
            if (tagIdx != -1 && urcResp.indexOf('\n', tagIdx) != -1) {
                getOk = true;
                break;
            }
        }
        if (getOk) break;
    }

    if (!getOk) {
        LOG_ERROR("HTTP GET timeout. URC raw: " + urcResp);
        while (_serial->available()) _serial->read();
        return false;
    }

    // Parse HTTP Response code from +QHTTPGET: <err>[,<httprspcode>[,<contentlen>]]
    int qIdx = urcResp.indexOf("+QHTTPGET:");
    if (qIdx != -1) {
        String sub = urcResp.substring(qIdx + 10);
        sub.trim();
        int comma1 = sub.indexOf(',');
        if (comma1 != -1) {
            int comma2 = sub.indexOf(',', comma1 + 1);
            if (comma2 != -1) {
                String codeStr = sub.substring(comma1 + 1, comma2);
                httpCode = codeStr.toInt();
            } else {
                String codeStr = sub.substring(comma1 + 1);
                httpCode = codeStr.toInt();
            }
        } else {
            LOG_ERROR("Modem HTTP GET Error URC: +QHTTPGET: " + sub);
        }
    }

    LOG_INFO("HTTP Response Code: " + String(httpCode));
    sendAT("AT+QHTTPREAD=80", 5000);
    while (_serial->available()) _serial->read();
    return (httpCode == 200 || httpCode == 201);
}
