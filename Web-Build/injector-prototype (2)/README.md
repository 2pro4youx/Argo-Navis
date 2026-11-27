# Argo Alert (`com.argo.alert`) — Android OEM Emergency Layer

An OEM-grade emergency alert and evacuation Android application written in **Kotlin** and **Jetpack Compose** with **zero third-party runtime dependencies** (pure Android SDK, `javax.crypto`, `HttpURLConnection`, `LocationManager`, `AudioTrack`, and `org.json`).

Designed to bypass Do Not Disturb, lock screens, and normal app distractions during verified natural disasters, guide citizens to nearby relief shelters on an offline isotropic metric radar map, and escalate missed check-ins to rescue command.

---

## Key Capabilities

- **Direct-Boot Background Polling (`BootReceiver`, `AlertService`)**: Starts on `LOCKED_BOOT_COMPLETED` and `BOOT_COMPLETED` (`directBootAware="true"`) as a `START_STICKY` `specialUse` foreground service polling `GET /api/device/poll` every **2 seconds**.
- **Constant-Time Cryptographic Verification (`CryptoAndGeo`)**: Verifies raw JSON alert payloads and `CLEARED` tokens using `HmacSHA256` (`javax.crypto.Mac`) and constant-time comparison (`MessageDigest.isEqual`) before parsing any fields.
- **Haversine Geofencing & Play-Services-Free Telemetry (`DeviceTelemetry`, `CryptoAndGeo`)**: Arbitrates `GPS_PROVIDER` and `NETWORK_PROVIDER` via native `LocationManager`, rejects `(0.0, 0.0)` null fixes, and evaluates distance against `region.radius_km`.
- **Reserved Power Mode (`AlertService`)**: Detects `BatteryManager` levels `<= 5%` and triggers `RESERVE_POWER_ACTIVE` telemetry while maintaining emergency visibility.
- **Lock-Screen & Kiosk Takeover (`AlertActivity`, `AdminReceiver`)**: Wakes the display (`turnScreenOn`), draws over keyguard (`showWhenLocked`), falls back to a high-priority `FullScreenIntent` notification, and enforces `startLockTask()` when provisioned as Device Owner.
- **Synthesized Hardware Siren & Haptics (`SirenController`)**: Generates an alternating **960 Hz / 720 Hz** two-tone siren (400 ms half-cycle) directly on `AudioAttributes.USAGE_ALARM` with alarm stream volume maximization and repeating vibration patterns for deaf/hard-of-hearing accessibility.
- **Two-Screen Emergency Compose UI (`AlertActivity`)**:
  - **Screen 1 (Takeover)**: Flashing high-contrast red warning screen, `SlideToEvacuate` swipe confirmation, and direct `ACTION_DIAL` (`tel:112`) emergency dialer trigger.
  - **Screen 2 (Evacuation & Check-In)**: Offline isotropic `cos(lat)` metric Canvas map showing user GPS, nearest green shelter, walking/direct route vector, disaster-specific protocol steps, and a circular **CHECK-IN** countdown ring that automatically broadcasts `ESCALATED` with live coordinates if the timer hits `0`.

---

## Project Structure

```text
app/src/main/
├── AndroidManifest.xml                      # directBootAware components, specialUse FGS, emergency permissions
├── res/
│   ├── values/
│   │   ├── strings.xml                      # App label and notification channel names
│   │   └── themes.xml                       # Fullscreen dark emergency theme with cutout support
│   └── xml/
│       ├── device_admin_receiver.xml        # DeviceAdminReceiver policy metadata
│       └── network_security_config.xml      # Scopes cleartext HTTP strictly to 10.0.2.2
└── java/com/argo/alert/
    ├── AdminReceiver.kt                     # DeviceAdminReceiver whitelisting LockTask mode
    ├── AlertActivity.kt                     # Compose UI (Screen 1 takeover + Screen 2 map, protocols, check-in)
    ├── AlertModels.kt                       # Data classes & org.json parsers for poll and payload JSON
    ├── AlertService.kt                      # Foreground service: 2s polling, WakeLock, 6-gate pipeline
    ├── AlertStateHolder.kt                  # Thread-safe StateFlow store shared between service and UI
    ├── BootReceiver.kt                      # LOCKED_BOOT_COMPLETED & BOOT_COMPLETED receiver
    ├── CryptoAndGeo.kt                      # HMAC-SHA256 verification, Haversine distance, nearest shelter
    ├── DeviceTelemetry.kt                   # LocationManager GPS/Network arbitration & BatteryManager reader
    ├── EventClient.kt                       # HttpURLConnection client for /api/device/poll & /api/device/event
    ├── MainActivity.kt                      # Diagnostic launcher for permissions, Device Owner status & service start
    └── SirenController.kt                   # AudioTrack dual-tone USAGE_ALARM synthesizer & vibrator controller
```

---

## Requirements

- **Android Studio**: Iguana / Koala or newer (AGP `8.5.2`, Kotlin `2.0.20`, Compose BOM `2024.09.03`)
- **JDK**: Java `17`
- **Android SDK**: `minSdk = 26` (Android 8.0), `targetSdk = 34` (Android 14)
- **Gateway Server**: Companion HTTP server listening on port `8000` (`http://10.0.2.2:8000` from the Android Emulator)

---

## Getting Started

### 1. Build & Install Debug APK

```bash
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### 2. Provision Device Owner (Enables Lock-Task Kiosk Mode)

Run on a fresh Android emulator or device with no signed-in accounts so `startLockTask()` pins `AlertActivity` without user confirmation:

```bash
adb shell dpm set-device-owner com.argo.alert/.AdminReceiver
```

### 3. Grant Runtime Permissions & Inject Mock GPS

```bash
adb shell pm grant com.argo.alert android.permission.ACCESS_FINE_LOCATION
adb shell pm grant com.argo.alert android.permission.ACCESS_COARSE_LOCATION
adb shell pm grant com.argo.alert android.permission.POST_NOTIFICATIONS
adb shell appops set com.argo.alert SYSTEM_ALERT_WINDOW allow

# Inject a GPS fix (longitude latitude)
adb emu geo fix 139.7671 35.6812
```

### 4. Test Direct Boot & 5% Reserve Battery Mode

```bash
adb shell dumpsys battery set level 4
adb reboot
```

---

## Verification Pipeline & Backend Wire Contract

`AlertService` polls the gateway every 2 seconds and reports ordered lifecycle events back to the server:

### Poll Request
```http
GET /api/device/poll?device=emu1&lat=<lat>&lon=<lon>&battery=<pct>&src=gps
```

**Active Alert Response:**
```json
{
  "status": "ACTIVE",
  "payload": "{\"alert_id\":\"argo-eq-01\",\"type\":\"EARTHQUAKE\",\"severity\":\"EXTREME\",\"headline\":\"Evacuate unstable structures immediately.\",\"region\":{\"center\":{\"lat\":35.685,\"lon\":139.77},\"radius_km\":15},\"shelters\":[{\"name\":\"Marunouchi Plaza\",\"lat\":35.6838,\"lon\":139.7642}],\"protocol_steps\":[\"Drop, cover, and hold on.\",\"Use stairs only.\"],\"protocol_note\":\"Civil Protection Directive CP-14\",\"checkin_interval_s\":30}",
  "sig": "<hex HMAC-SHA256 of raw payload>"
}
```

**Signed All-Clear Response:**
```json
{
  "status": "CLEARED",
  "alert_id": "argo-eq-01",
  "clear_sig": "<hex HMAC-SHA256 of 'argo-eq-01|CLEARED'>"
}
```

### Event Reporting
```http
POST /api/device/event
Content-Type: application/json
```
```json
{
  "device": "emu1",
  "event": "NEAREST_SHELTER",
  "detail": "shelter=Marunouchi Plaza distance_km=0.39",
  "lat": 35.6812,
  "lon": 139.7671
}
```

**Emitted Event Sequence:**
1. `ALERT_RECEIVED` — Payload received and deduplicated
2. `SIGNATURE_OK` / `SIGNATURE_FAIL` — Constant-time HMAC-SHA256 verification
3. `IN_REGION` / `OUT_OF_REGION` — Haversine geofence check against `region.radius_km`
4. `RESERVE_POWER_ACTIVE` — Emitted if battery is `<= 5%`
5. `SIREN_ON` — Screen 1 lock-screen takeover & `USAGE_ALARM` siren started
6. `SLIDER_CONFIRMED` & `NEAREST_SHELTER` — User slid to evacuate; Screen 2 routing active
7. `CHECKIN` / `ESCALATED` — Check-in reset or missed-timer rescue escalation
8. `ALL_CLEAR` — Signed clear token verified and device released

---

## Security Notes

- The demo shared secret (`argo-demo-shared-secret` in `CryptoAndGeo.kt`) is for local simulation only. Production deployments should replace symmetric HMAC keys with asymmetric signatures backed by Android Keystore / hardware-protected OEM trust anchors.
- `network_security_config.xml` explicitly restricts cleartext HTTP traffic to `10.0.2.2`; production endpoints must enforce HTTPS.