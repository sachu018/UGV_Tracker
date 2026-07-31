#ifndef EC200U_H
#define EC200U_H

#include <Arduino.h>
#include "Types.h"

class EC200U {
public:
    EC200U();
    ~EC200U();

    // Hardware initialization
    bool begin(HardwareSerial &serial, uint32_t baud, int8_t rxPin, int8_t txPin);

    // Low-level AT Command functions
    String sendAT(const String &cmd, uint32_t timeoutMs = 2000);
    bool waitForResponse(const String &expected, uint32_t timeoutMs = 2000);

    // Cellular & Network operations
    bool checkSIM();
    bool waitForNetwork(uint32_t timeoutMs = 30000);
    int getSignalStrength(); // Returns CSQ (0..31, 99)
    bool setLowPowerMode(bool enable);

    // GPS / GNSS operations
    bool enableGPS();
    bool disableGPS();
    bool getLocation(GPSData &gpsData);

    // Data / Internet operations
    bool activatePDPContext(const String &apn);
    bool postHTTP(const String &url, const String &jsonPayload, int &httpCode, String &responseBody);
    bool getHTTP(const String &url, int &httpCode, String &responseBody);

private:
    HardwareSerial* _serial;
    bool _isGpsEnabled;

    // Helper parser for Quectel +QGPSLOC command response
    bool parseQGPSLOC(const String &rawResponse, GPSData &gpsData);
    double convertNMEAToDecimal(const String &nmeaPos, char direction);
};

#endif // EC200U_H
