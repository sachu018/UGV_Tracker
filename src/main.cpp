#include <Arduino.h>
#include "Tracker.h"
#include "Config.h"

Tracker tracker;

void setup() {
    DEBUG_SERIAL.begin(DEBUG_BAUD);
    delay(1000);
    tracker.begin();
}

void loop() {
    tracker.update();
}
