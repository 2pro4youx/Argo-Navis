import settingsGradle from '../../android/settings.gradle.kts?raw';
import rootBuildGradle from '../../android/build.gradle.kts?raw';
import gradleProperties from '../../android/gradle.properties?raw';
import appBuildGradle from '../../android/app/build.gradle.kts?raw';
import proguardRules from '../../android/app/proguard-rules.pro?raw';
import androidManifest from '../../android/app/src/main/AndroidManifest.xml?raw';
import networkSecurityConfig from '../../android/app/src/main/res/xml/network_security_config.xml?raw';
import deviceAdminReceiver from '../../android/app/src/main/res/xml/device_admin_receiver.xml?raw';
import stringsXml from '../../android/app/src/main/res/values/strings.xml?raw';
import themesXml from '../../android/app/src/main/res/values/themes.xml?raw';
import alertServiceKt from '../../android/app/src/main/java/com/argo/alert/AlertService.kt?raw';
import alertActivityKt from '../../android/app/src/main/java/com/argo/alert/AlertActivity.kt?raw';
import sirenControllerKt from '../../android/app/src/main/java/com/argo/alert/SirenController.kt?raw';
import bootReceiverKt from '../../android/app/src/main/java/com/argo/alert/BootReceiver.kt?raw';
import adminReceiverKt from '../../android/app/src/main/java/com/argo/alert/AdminReceiver.kt?raw';
import cryptoAndGeoKt from '../../android/app/src/main/java/com/argo/alert/CryptoAndGeo.kt?raw';
import deviceTelemetryKt from '../../android/app/src/main/java/com/argo/alert/DeviceTelemetry.kt?raw';
import eventClientKt from '../../android/app/src/main/java/com/argo/alert/EventClient.kt?raw';
import alertModelsKt from '../../android/app/src/main/java/com/argo/alert/AlertModels.kt?raw';
import alertStateHolderKt from '../../android/app/src/main/java/com/argo/alert/AlertStateHolder.kt?raw';
import mainActivityKt from '../../android/app/src/main/java/com/argo/alert/MainActivity.kt?raw';

export interface AndroidProjectFile {
  id: string;
  name: string;
  path: string;
  group: 'Kotlin Sources' | 'Manifest & XML' | 'Gradle Config';
  language: 'kotlin' | 'xml' | 'gradle';
  summary: string;
  content: string;
}

export const ANDROID_PROJECT_FILES: AndroidProjectFile[] = [
  {
    id: 'AlertService.kt',
    name: 'AlertService.kt',
    path: 'app/src/main/java/com/argo/alert/AlertService.kt',
    group: 'Kotlin Sources',
    language: 'kotlin',
    summary: 'START_STICKY foreground service polling 10.0.2.2:8000 every 2s, 6-step verification, full-screen-intent fallback.',
    content: alertServiceKt,
  },
  {
    id: 'AlertActivity.kt',
    name: 'AlertActivity.kt',
    path: 'app/src/main/java/com/argo/alert/AlertActivity.kt',
    group: 'Kotlin Sources',
    language: 'kotlin',
    summary: 'Lock-screen Compose takeover (Screen 1 flashing red + slide-to-evacuate, Screen 2 Canvas map + protocol + CHECK-IN ring).',
    content: alertActivityKt,
  },
  {
    id: 'SirenController.kt',
    name: 'SirenController.kt',
    path: 'app/src/main/java/com/argo/alert/SirenController.kt',
    group: 'Kotlin Sources',
    language: 'kotlin',
    summary: 'Two-tone alternating AudioTrack (USAGE_ALARM) with max alarm volume, quiet/pause modes, and repeating vibration.',
    content: sirenControllerKt,
  },
  {
    id: 'CryptoAndGeo.kt',
    name: 'CryptoAndGeo.kt',
    path: 'app/src/main/java/com/argo/alert/CryptoAndGeo.kt',
    group: 'Kotlin Sources',
    language: 'kotlin',
    summary: 'javax.crypto.Mac HMAC-SHA256 constant-time hex compare, Haversine distance, and nearest shelter calculation.',
    content: cryptoAndGeoKt,
  },
  {
    id: 'EventClient.kt',
    name: 'EventClient.kt',
    path: 'app/src/main/java/com/argo/alert/EventClient.kt',
    group: 'Kotlin Sources',
    language: 'kotlin',
    summary: 'HttpURLConnection GET /api/device/poll and POST /api/device/event JSON client with zero external libraries.',
    content: eventClientKt,
  },
  {
    id: 'DeviceTelemetry.kt',
    name: 'DeviceTelemetry.kt',
    path: 'app/src/main/java/com/argo/alert/DeviceTelemetry.kt',
    group: 'Kotlin Sources',
    language: 'kotlin',
    summary: 'LocationManager GPS_PROVIDER tracker (no Google Play Services) and BatteryManager percentage reader.',
    content: deviceTelemetryKt,
  },
  {
    id: 'BootReceiver.kt',
    name: 'BootReceiver.kt',
    path: 'app/src/main/java/com/argo/alert/BootReceiver.kt',
    group: 'Kotlin Sources',
    language: 'kotlin',
    summary: 'Direct-boot-aware receiver starting AlertService on LOCKED_BOOT_COMPLETED and BOOT_COMPLETED.',
    content: bootReceiverKt,
  },
  {
    id: 'AdminReceiver.kt',
    name: 'AdminReceiver.kt',
    path: 'app/src/main/java/com/argo/alert/AdminReceiver.kt',
    group: 'Kotlin Sources',
    language: 'kotlin',
    summary: 'DeviceAdminReceiver enabling Device Owner lock-task whitelisting for com.argo.alert.',
    content: adminReceiverKt,
  },
  {
    id: 'AlertModels.kt',
    name: 'AlertModels.kt',
    path: 'app/src/main/java/com/argo/alert/AlertModels.kt',
    group: 'Kotlin Sources',
    language: 'kotlin',
    summary: 'Data models and org.json parsers for poll responses and emergency payloads.',
    content: alertModelsKt,
  },
  {
    id: 'AlertStateHolder.kt',
    name: 'AlertStateHolder.kt',
    path: 'app/src/main/java/com/argo/alert/AlertStateHolder.kt',
    group: 'Kotlin Sources',
    language: 'kotlin',
    summary: 'Reactive StateFlow holder bridging AlertService and AlertActivity lifecycle events.',
    content: alertStateHolderKt,
  },
  {
    id: 'MainActivity.kt',
    name: 'MainActivity.kt',
    path: 'app/src/main/java/com/argo/alert/MainActivity.kt',
    group: 'Kotlin Sources',
    language: 'kotlin',
    summary: 'Initial launcher screen for GPS/notification runtime permissions, Device Owner status, and AlertService start.',
    content: mainActivityKt,
  },
  {
    id: 'AndroidManifest.xml',
    name: 'AndroidManifest.xml',
    path: 'app/src/main/AndroidManifest.xml',
    group: 'Manifest & XML',
    language: 'xml',
    summary: 'All required OEM emergency permissions, directBootAware components, specialUse FGS subtype, and AlertActivity attributes.',
    content: androidManifest,
  },
  {
    id: 'network_security_config.xml',
    name: 'network_security_config.xml',
    path: 'app/src/main/res/xml/network_security_config.xml',
    group: 'Manifest & XML',
    language: 'xml',
    summary: 'Permits cleartext HTTP exclusively to emulator host 10.0.2.2.',
    content: networkSecurityConfig,
  },
  {
    id: 'device_admin_receiver.xml',
    name: 'device_admin_receiver.xml',
    path: 'app/src/main/res/xml/device_admin_receiver.xml',
    group: 'Manifest & XML',
    language: 'xml',
    summary: 'DeviceAdminReceiver policy metadata for lock task mode.',
    content: deviceAdminReceiver,
  },
  {
    id: 'strings.xml',
    name: 'strings.xml',
    path: 'app/src/main/res/values/strings.xml',
    group: 'Manifest & XML',
    language: 'xml',
    summary: 'App name ("Argo Alert") and notification channel labels.',
    content: stringsXml,
  },
  {
    id: 'themes.xml',
    name: 'themes.xml',
    path: 'app/src/main/res/values/themes.xml',
    group: 'Manifest & XML',
    language: 'xml',
    summary: 'Dark fullscreen emergency theme with display cutout support.',
    content: themesXml,
  },
  {
    id: 'app/build.gradle.kts',
    name: 'app/build.gradle.kts',
    path: 'app/build.gradle.kts',
    group: 'Gradle Config',
    language: 'gradle',
    summary: 'com.argo.alert module config (minSdk 26, targetSdk 34, Jetpack Compose BOM, no extra libraries).',
    content: appBuildGradle,
  },
  {
    id: 'build.gradle.kts',
    name: 'build.gradle.kts',
    path: 'build.gradle.kts',
    group: 'Gradle Config',
    language: 'gradle',
    summary: 'Top-level Android Gradle Plugin & Kotlin Compose plugin declarations.',
    content: rootBuildGradle,
  },
  {
    id: 'settings.gradle.kts',
    name: 'settings.gradle.kts',
    path: 'settings.gradle.kts',
    group: 'Gradle Config',
    language: 'gradle',
    summary: 'Root project settings for ArgoAlert.',
    content: settingsGradle,
  },
  {
    id: 'gradle.properties',
    name: 'gradle.properties',
    path: 'gradle.properties',
    group: 'Gradle Config',
    language: 'gradle',
    summary: 'Gradle JVM and AndroidX build flags.',
    content: gradleProperties,
  },
  {
    id: 'proguard-rules.pro',
    name: 'proguard-rules.pro',
    path: 'app/proguard-rules.pro',
    group: 'Gradle Config',
    language: 'gradle',
    summary: 'Keep rules for AlertService, BootReceiver, AdminReceiver, and AlertActivity.',
    content: proguardRules,
  },
];
