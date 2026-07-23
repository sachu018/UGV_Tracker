#ifndef GPS_H
#define GPS_H

#include <Arduino.h>
#include "EC200U.h"
#include "Types.h"

class GPS {
public:
    explicit GPS(EC200U &modem);

    bool begin();
    bool update();
    bool hasFix() const;
    const GPSData& getData() const;
    void printDebug() const;

private:
    EC200U &_modem;
    GPSData _currentData;
    uint32_t _lastUpdateMs;
};

#endif // GPS_H
