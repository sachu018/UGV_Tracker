#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// Debug configuration
#define DEBUG_SERIAL Serial
#define DEBUG_BAUD   115200

#define LOG_INFO(x)  DEBUG_SERIAL.print("[INFO] "); DEBUG_SERIAL.println(x)
#define LOG_ERROR(x) DEBUG_SERIAL.print("[ERROR] "); DEBUG_SERIAL.println(x)
#define LOG_DEBUG(x) DEBUG_SERIAL.print("[DEBUG] "); DEBUG_SERIAL.println(x)

// Hardware Serial settings for EC200U
#define EC200U_SERIAL       Serial2
#define EC200U_BAUD         115200
#define EC200U_RX_PIN       16   // ESP32 RX2 (Connect to EC200U TX)
#define EC200U_TX_PIN       17   // ESP32 TX2 (Connect to EC200U RX)

// Cellular Network Configuration
#define CELLULAR_APN        "airtelgprs.com" // Replace with your SIM card APN

// Custom FastAPI Backend Telemetry Configuration (24/7 Cloud Render URL)
#define SERVER_URL          "https://ugv-tracker-server.onrender.com/api/v1/telemetry/update"
#define THINGSPEAK_URL      "https://api.thingspeak.com/update"
#define THINGSPEAK_API_KEY  "URP875F2003RSKLM"
#define DEVICE_ID           "UGV-TRACKER-01"

// Timing & Retries (ThingSpeak requires at least 15 seconds between updates)
#define GPS_POLL_INTERVAL_MS      2000   // 2 seconds
#define TELEMETRY_INTERVAL_MS     15000  // 15 seconds
#define NETWORK_TIMEOUT_MS        30000  // 30 seconds
#define AT_DEFAULT_TIMEOUT_MS     2000   // 2 seconds

#endif // CONFIG_H
