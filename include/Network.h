#ifndef NETWORK_H
#define NETWORK_H

#include <Arduino.h>
#include "EC200U.h"

class Network {
public:
    explicit Network(EC200U &modem);

    bool checkSIM();
    bool connect(const String &apn, uint32_t timeoutMs = 30000);
    bool isConnected() const;
    int getSignalStrength();

private:
    EC200U &_modem;
    bool _connected;
};

#endif // NETWORK_H
