#include "Network.h"
#include "Config.h"

Network::Network(EC200U &modem) : _modem(modem), _connected(false) {}

bool Network::checkSIM() {
    return _modem.checkSIM();
}

bool Network::connect(const String &apn, uint32_t timeoutMs) {
    LOG_INFO("Connecting network using APN: " + apn);
    
    if (!_modem.waitForNetwork(timeoutMs)) {
        _connected = false;
        return false;
    }

    if (!_modem.activatePDPContext(apn)) {
        _connected = false;
        return false;
    }

    _connected = true;
    LOG_INFO("Cellular Network & PDP context ready!");
    return true;
}

bool Network::isConnected() const {
    return _connected;
}

int Network::getSignalStrength() {
    return _modem.getSignalStrength();
}
