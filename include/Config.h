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

// Dual Telemetry Backend Server URLs (Vendor + Custom Render Cloud)
#define VENDOR_SERVER_URL   "https://tracker.reving.in/api/v1/telemetry/update"
#define RENDER_SERVER_URL   "https://ugv-tracker-server.onrender.com/api/v1/telemetry/update"
#define SERVER_URL          VENDOR_SERVER_URL
#define DEVICE_ID           "UGV-TRACKER-01"
#define DEVICE_API_KEY      "0ddfccf1d3fca880135268e79197564a3fabc788f2a447c2"

// Battery Voltage Measurement (GPIO 34 ADC Voltage Divider: 100k + 100k)
#define BATTERY_ADC_PIN     34
#define BATTERY_LOW_CUTOFF  3.30f  // Critical Low Battery Voltage threshold

// Timing & Retries
#define GPS_POLL_INTERVAL_MS      2000   // 2 seconds
#define TELEMETRY_INTERVAL_MS     15000  // 15 seconds in Moving Mode
#define NETWORK_TIMEOUT_MS        30000  // 30 seconds
#define AT_DEFAULT_TIMEOUT_MS     2000   // 2 seconds

// Deep Sleep Testing Configuration (15 Min Parked Sleep / 2 Min Stationary Trigger)
#define PARKED_SLEEP_INTERVAL_SEC (15 * 60)       // 15 minutes (900 seconds)
#define STATIONARY_TIMEOUT_MS     (2 * 60 * 1000)  // 2 minutes stationary before deep sleep

// SMS Alert Notifications Configuration (Wakeup & Low Battery Alerts)
#define ENABLE_SMS_ALERTS        true
#define SMS_PHONE_NUMBER_1       "+916238227874"  // Primary recipient number
#define SMS_PHONE_NUMBER_2       ""               // Optional 2nd recipient number
#define SMS_PHONE_NUMBER_3       ""               // Optional 3rd recipient number

#endif // CONFIG_H
