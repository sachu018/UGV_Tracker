#include <Arduino.h>
#include "Tracker.h"
#include "Config.h"

Tracker tracker;

void setup() {
    DEBUG_SERIAL.begin(DEBUG_BAUD);
    delay(1500); // Wait for Serial Monitor connection
    DEBUG_SERIAL.println();
    DEBUG_SERIAL.println("==========================================");
    DEBUG_SERIAL.println("    UGV Standalone GPS Tracker System     ");
    DEBUG_SERIAL.println("==========================================");
    tracker.begin();
}

void loop() {
    tracker.update();
    yield();
}
