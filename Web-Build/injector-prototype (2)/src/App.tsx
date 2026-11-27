import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  MapPin,
  MapPinOff,
  Navigation,
  ShieldX,
  Volume2,
  VolumeX,
} from 'lucide-react';
import heroArgoImg from './assets/images/hero_argo_navis_1795505537836.jpg';
import {
  DEVICE_ID,
  DISASTER_PROTOCOLS,
  PROTOCOL_NOTE_SAMPLE,
  PYTHON_CITIES,
  SCENARIO_PRESETS,
  findNearestShelter,
  generateDemoShelters,
  haversineKm,
  hmacSha256Hex,
  isValidGpsFix,
  processPollResponse,
  type AlertPayload,
  type DeviceEvent,
  type GeoPoint,
  type PollResponse,
  type ServiceState,
} from './core/argoEngine';
import { ANDROID_PROJECT_FILES } from './core/androidProjectFiles';
import { createZipBytes } from './core/zipBuilder';
import { attachWalkingRoutes, findSheltersForLocation } from './utils/geoLookup';
import { webSiren, type SirenMode } from './utils/webSiren';
import { AndroidEmulator, type EmulatorScreen } from './components/AndroidEmulator';
import { EventLogPanel } from './components/EventLogPanel';
import {
  SatelliteEvacuationMap,
  type DeviceStatus,
} from './components/SatelliteEvacuationMap';
import { SourceExplorer } from './components/SourceExplorer';
import { SetupGuide } from './components/SetupGuide';
import { ThemeToggleButton } from './components/ThemeToggleButton';
import {
  hapticAlert,
  hapticConfirm,
  hapticReject,
  hapticTap,
  setHapticsEnabled,
  useHapticsEnabled,
} from './utils/haptics';

type WorkspaceTab = 'simulator' | 'source' | 'setup';
type MobileSimPane = 'all' | 'controls' | 'phone' | 'map';
type AlertCenterMode = 'LIVE' | string;

const GITHUB_REPO_URL = 'https://github.com/2pro4youx/Argo-Navis';
const GITHUB_CLONE_CMD = 'git clone https://github.com/2pro4youx/Argo-Navis.git';
const DISASTER_TYPES = ['EARTHQUAKE', 'TSUNAMI', 'FLASH FLOOD', 'FLOOD', 'CYCLONE', 'WILDFIRE'] as const;

const STATUS_BADGE_STYLE: Record<DeviceStatus, string> = {
  IDLE: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  ALERTED: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300',
  EVACUATING: 'bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-300',
  CHECKED_IN: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-300',
  ESCALATED: 'bg-red-100 text-red-900 dark:bg-red-500/25 dark:text-red-300',
};

const PROTOCOL_STAGES = [
  {
    index: '01',
    event: 'ALERT_RECEIVED',
    title: 'Direct-Boot Polling & Deduplication',
    detail:
      'AlertService starts on LOCKED_BOOT_COMPLETED before device unlock, polling /api/device/poll every 2 seconds and deduplicating seen payloads.',
  },
  {
    index: '02',
    event: 'SIGNATURE_OK',
    title: 'Constant-Time HMAC-SHA256 Verification',
    detail:
      'CryptoAndGeo verifies the raw JSON payload signature before parsing any fields; tampered alerts stop at SIGNATURE_FAIL.',
  },
  {
    index: '03',
    event: 'IN_REGION',
    title: 'Haversine Geofence Filtering',
    detail:
      'DeviceTelemetry arbitrates GPS_PROVIDER and NETWORK_PROVIDER fixes, rejects (0.0, 0.0) null coordinates, and checks distance against region.radius_km.',
  },
  {
    index: '04',
    event: 'RESERVE_POWER_ACTIVE',
    title: '5% Reserved Battery Mode',
    detail:
      'When BatteryManager reports <= 5% charge, Argo Navis activates reserved emergency power behavior while maintaining alarm visibility.',
  },
  {
    index: '05',
    event: 'SIREN_ON',
    title: 'Lock-Task Takeover & USAGE_ALARM Siren',
    detail:
      'Launches full-screen AlertActivity over the lock screen, binds Device Owner lock task mode via AdminReceiver, and drives an alternating two-tone AudioTrack.',
  },
  {
    index: '06',
    event: 'CHECKIN · ALL_CLEAR',
    title: 'Evacuation Routing, Check-In & Signed Clear',
    detail:
      'Sliding to evacuate opens Screen 2 with satellite/metric shelter navigation, periodic check-in timer with escalation, and HMAC-signed All Clear dismissal.',
  },
] as const;

const ARCHITECTURE_MODULES = [
  {
    id: 'AlertService.kt',
    span: 'md:col-span-7',
    tag: 'Kotlin · Foreground Service',
    title: 'AlertService.kt & BootReceiver.kt',
    description:
      'START_STICKY foreground service registered with FOREGROUND_SERVICE_SPECIAL_USE and directBootAware="true" so polling resumes immediately on boot and launches AlertActivity with a full-screen-intent notification fallback.',
    fileId: 'AlertService.kt',
  },
  {
    id: 'CryptoAndGeo.kt',
    span: 'md:col-span-5',
    tag: 'Kotlin · Security & Telemetry',
    title: 'CryptoAndGeo.kt & DeviceTelemetry.kt',
    description:
      'Implements javax.crypto.Mac HMAC-SHA256 verification, Haversine distance math, and multi-provider location arbitration without Google Play Services.',
    fileId: 'CryptoAndGeo.kt',
  },
  {
    id: 'AlertActivity.kt',
    span: 'md:col-span-5',
    tag: 'Jetpack Compose · AudioTrack',
    title: 'AlertActivity.kt & SirenController.kt',
    description:
      'Two-screen emergency Compose UI featuring flashing Screen 1 lock-screen override, isotropic cos(lat) Canvas evacuation map, and hardware-volume alarm synthesis.',
    fileId: 'AlertActivity.kt',
  },
  {
    id: 'argo_sim.py',
    span: 'md:col-span-7',
    tag: 'Python Standard Library · Rescue Gateway',
    title: 'argo_sim.py Companion Gateway & Control Room',
    description:
      'Zero-dependency Python server running the /api/device/poll and /api/device/event endpoints on port 8000, querying OpenStreetMap Overpass shelters across 7 amenity types and OSRM walking routes with disk caching.',
    fileId: null,
  },
] as const;

function formatNow(): string {
  const now = new Date();
  return now.toTimeString().slice(0, 8);
}

export default function App() {
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [copiedClone, setCopiedClone] = useState(false);
  const hapticsEnabled = useHapticsEnabled();

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('simulator');
  const [mobileSimPane, setMobileSimPane] = useState<MobileSimPane>('all');
  const [sourceFileId, setSourceFileId] = useState<string>(ANDROID_PROJECT_FILES[0].id);
  const [alertCenter, setAlertCenter] = useState<AlertCenterMode>(SCENARIO_PRESETS[0].id);
  const [disasterType, setDisasterType] = useState<string>(SCENARIO_PRESETS[0].payload.type);
  const [alertRadiusKm, setAlertRadiusKm] = useState<number>(
    SCENARIO_PRESETS[0].payload.region.radius_km,
  );
  const [useLiveOsmLookup, setUseLiveOsmLookup] = useState<boolean>(true);
  const [isDispatching, setIsDispatching] = useState<boolean>(false);

  // Device telemetry & GPS state
  const [userLocation, setUserLocation] = useState<GeoPoint>(
    SCENARIO_PRESETS[0].defaultUserLocation,
  );
  const [gpsSource, setGpsSource] = useState<'live' | 'manual' | 'preset'>('preset');
  const [gpsAccuracyM, setGpsAccuracyM] = useState<number | null>(null);
  const [gpsWatchActive, setGpsWatchActive] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const geoWatchIdRef = useRef<number | null>(null);

  const [batteryPct, setBatteryPct] = useState<number>(68);
  const [checkinIntervalS, setCheckinIntervalS] = useState<number>(30);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(false);
  const [flashingEnabled, setFlashingEnabled] = useState<boolean>(true);

  // AlertService & AlertActivity runtime state
  const [serviceState, setServiceState] = useState<ServiceState>({
    seenPayloads: [],
    activeAlert: null,
    reservePowerActive: false,
  });
  const [screen, setScreen] = useState<EmulatorScreen>('standby');
  const [sirenMode, setSirenMode] = useState<SirenMode>('off');
  const [remainingSeconds, setRemainingSeconds] = useState<number>(30);
  const [hasCheckedInOnce, setHasCheckedInOnce] = useState<boolean>(false);
  const [escalated, setEscalated] = useState<boolean>(false);
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [alertNonce, setAlertNonce] = useState<number>(1);
  const eventCounterRef = useRef<number>(1);

  const selectedScenario = useMemo(
    () => SCENARIO_PRESETS.find((s) => s.id === alertCenter) ?? null,
    [alertCenter],
  );
  const selectedPythonCity = useMemo(
    () => PYTHON_CITIES.find((c) => c.id === alertCenter) ?? null,
    [alertCenter],
  );

  // Target region center based on selected alert center
  const targetRegionCenter: GeoPoint = useMemo(() => {
    if (alertCenter === 'LIVE') return userLocation;
    if (selectedPythonCity) return { lat: selectedPythonCity.lat, lon: selectedPythonCity.lon };
    if (selectedScenario) return selectedScenario.payload.region.center;
    return userLocation;
  }, [alertCenter, userLocation, selectedPythonCity, selectedScenario]);

  const previewRegion = useMemo(
    () => ({ center: targetRegionCenter, radius_km: alertRadiusKm }),
    [targetRegionCenter, alertRadiusKm],
  );

  const outsideZoneLocation: GeoPoint = useMemo(() => {
    if (selectedScenario) return selectedScenario.outsideUserLocation;
    const offsetDeg = (alertRadiusKm + 8) / 110.57;
    return {
      lat: Number((targetRegionCenter.lat + offsetDeg).toFixed(5)),
      lon: Number((targetRegionCenter.lon + offsetDeg).toFixed(5)),
    };
  }, [selectedScenario, alertRadiusKm, targetRegionCenter]);

  const deviceStatus: DeviceStatus = useMemo(() => {
    if (!serviceState.activeAlert || screen === 'standby') return 'IDLE';
    if (escalated) return 'ESCALATED';
    if (screen === 'screen1') return 'ALERTED';
    if (hasCheckedInOnce) return 'CHECKED_IN';
    return 'EVACUATING';
  }, [serviceState.activeAlert, screen, escalated, hasCheckedInOnce]);

  const appendEvents = useCallback((items: Omit<DeviceEvent, 'id' | 'timestamp'>[]) => {
    if (items.length === 0) return;
    const ts = formatNow();
    const stamped: DeviceEvent[] = items.map((item) => ({
      ...item,
      id: `ev-${eventCounterRef.current++}`,
      timestamp: ts,
    }));
    setEvents((prev) => [...stamped.reverse(), ...prev]);
  }, []);

  const postSingleEvent = useCallback(
    (event: DeviceEvent['event'], detail: string, loc: GeoPoint) => {
      appendEvents([
        {
          device: DEVICE_ID,
          event,
          detail,
          lat: Number(loc.lat.toFixed(6)),
          lon: Number(loc.lon.toFixed(6)),
        },
      ]);
    },
    [appendEvents],
  );

  // Sync Web Audio siren engine
  useEffect(() => {
    webSiren.setAudioEnabled(audioEnabled);
  }, [audioEnabled]);

  useEffect(() => {
    webSiren.setMode(sirenMode);
  }, [sirenMode]);

  useEffect(() => {
    return () => {
      webSiren.setMode('off');
      if (geoWatchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
      }
    };
  }, []);

  // Toggle browser Geolocation API watch
  const handleToggleLiveGps = () => {
    hapticTap();
    if (gpsWatchActive) {
      if (geoWatchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
        geoWatchIdRef.current = null;
      }
      setGpsWatchActive(false);
      setGpsError(null);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError('Geolocation API is unavailable in this browser.');
      return;
    }

    setGpsError(null);
    setGpsWatchActive(true);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const nextLoc: GeoPoint = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lon: Number(pos.coords.longitude.toFixed(6)),
        };
        if (isValidGpsFix(nextLoc)) {
          setUserLocation(nextLoc);
          setGpsSource('live');
          setGpsAccuracyM(pos.coords.accuracy ?? null);
          setGpsError(null);
        }
      },
      (err) => {
        setGpsError(err.message || 'Location permission denied or unavailable.');
        setGpsWatchActive(false);
        if (geoWatchIdRef.current !== null) {
          navigator.geolocation.clearWatch(geoWatchIdRef.current);
          geoWatchIdRef.current = null;
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
    );
    geoWatchIdRef.current = id;
  };

  // Stop live GPS watch when user manually overrides coordinates
  const setManualGpsLocation = useCallback(
    (loc: GeoPoint, source: 'manual' | 'preset' = 'manual') => {
      if (gpsWatchActive && geoWatchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
        geoWatchIdRef.current = null;
        setGpsWatchActive(false);
      }
      setUserLocation(loc);
      setGpsSource(source);
      setGpsAccuracyM(null);
      setGpsError(null);
    },
    [gpsWatchActive],
  );

  // Build payload synchronously or asynchronously with OSM + OSRM
  const buildBasePayload = useCallback(
    (nonceValue: number): AlertPayload => {
      if (selectedScenario) {
        const steps =
          disasterType === selectedScenario.payload.type
            ? selectedScenario.payload.protocol_steps
            : (DISASTER_PROTOCOLS[disasterType] ?? selectedScenario.payload.protocol_steps);
        return {
          ...selectedScenario.payload,
          alert_id: `${selectedScenario.payload.alert_id}-${nonceValue}`,
          type: disasterType,
          headline:
            disasterType === selectedScenario.payload.type
              ? selectedScenario.payload.headline
              : `WARNING ${disasterType} ALERT: ${selectedScenario.label}`,
          region: {
            center: targetRegionCenter,
            radius_km: alertRadiusKm,
          },
          protocol_steps: steps,
          shelter_source: 'Scenario preset',
          checkin_interval_s: checkinIntervalS,
        };
      }

      const placeLabel =
        alertCenter === 'LIVE'
          ? 'Your Live GPS Area'
          : `${selectedPythonCity?.name ?? 'Custom'} Region`;

      return {
        alert_id: `argo-${alertCenter}-${nonceValue}`,
        type: disasterType,
        severity: 'WARNING',
        headline: `WARNING ${disasterType} ALERT: ${placeLabel}`,
        region: {
          center: targetRegionCenter,
          radius_km: alertRadiusKm,
        },
        shelters: generateDemoShelters(targetRegionCenter.lat, targetRegionCenter.lon),
        shelter_source: 'DEMO shelters (offline fallback)',
        protocol_steps: DISASTER_PROTOCOLS[disasterType] ?? DISASTER_PROTOCOLS.FLOOD,
        protocol_note: PROTOCOL_NOTE_SAMPLE,
        checkin_interval_s: checkinIntervalS,
      };
    },
    [
      selectedScenario,
      selectedPythonCity,
      alertCenter,
      disasterType,
      targetRegionCenter,
      alertRadiusKm,
      checkinIntervalS,
    ],
  );

  const buildPayloadWithLiveGeo = useCallback(
    async (nonceValue: number, routeOrigin: GeoPoint): Promise<AlertPayload> => {
      const base = buildBasePayload(nonceValue);
      if (!useLiveOsmLookup) {
        return base;
      }

      try {
        const lookup = await findSheltersForLocation(
          base.region.center.lat,
          base.region.center.lon,
          5,
        );
        const sheltersWithRoutes = await attachWalkingRoutes(routeOrigin, lookup.shelters, 3);
        return {
          ...base,
          shelters: sheltersWithRoutes,
          shelter_source: lookup.source,
        };
      } catch {
        return base;
      }
    },
    [buildBasePayload, useLiveOsmLookup],
  );

  // Dispatch a simulated GET /api/device/poll response through AlertService's 6-step pipeline
  const runPollPipeline = useCallback(
    (response: PollResponse, locOverride?: GeoPoint, batteryOverride?: number) => {
      const loc = locOverride ?? userLocation;
      const bat = batteryOverride ?? batteryPct;
      const result = processPollResponse(serviceState, response, loc, bat);
      setServiceState(result.nextState);
      appendEvents(result.emittedEvents);

      if (result.action === 'LAUNCH_ALERT' && result.nextState.activeAlert) {
        hapticAlert();
        setScreen('screen1');
        setSirenMode('full');
        setRemainingSeconds(result.nextState.activeAlert.checkin_interval_s);
        setHasCheckedInOnce(false);
        setEscalated(false);
      } else if (result.action === 'CLEAR_ALERT') {
        hapticConfirm();
        setScreen('standby');
        setSirenMode('off');
        setHasCheckedInOnce(false);
        setEscalated(false);
      } else if (
        result.emittedEvents.some(
          (ev) => ev.event === 'SIGNATURE_FAIL' || ev.event === 'OUT_OF_REGION',
        )
      ) {
        hapticReject();
      }
    },
    [serviceState, userLocation, batteryPct, appendEvents],
  );

  // ?autostart=1 support for immediate active alert preview
  const autostartDoneRef = useRef(false);
  useEffect(() => {
    if (autostartDoneRef.current) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      autostartDoneRef.current = true;
      const payload = buildBasePayload(1);
      const raw = JSON.stringify(payload);
      const sig = hmacSha256Hex(raw);
      runPollPipeline({ status: 'ACTIVE', payload: raw, sig });
      setAlertNonce(2);
    }
  }, [buildBasePayload, runPollPipeline]);

  // Dynamically refresh OSRM walking route from user's updated GPS when an alert is active
  const lastRoutedGpsRef = useRef<string>('');
  useEffect(() => {
    const alert = serviceState.activeAlert;
    if (!alert || !useLiveOsmLookup || !isValidGpsFix(userLocation)) return;
    const key = `${alert.alert_id}:${userLocation.lat.toFixed(4)},${userLocation.lon.toFixed(4)}`;
    if (lastRoutedGpsRef.current === key) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      lastRoutedGpsRef.current = key;
      const updatedShelters = await attachWalkingRoutes(userLocation, alert.shelters, 3);
      if (cancelled) return;
      setServiceState((prev) => {
        if (!prev.activeAlert || prev.activeAlert.alert_id !== alert.alert_id) return prev;
        return {
          ...prev,
          activeAlert: {
            ...prev.activeAlert,
            shelters: updatedShelters,
          },
        };
      });
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [serviceState.activeAlert, userLocation, useLiveOsmLookup]);

  // Screen 2 countdown timer (matches AlertActivity.kt behavior)
  useEffect(() => {
    if (screen !== 'screen2' || escalated || !serviceState.activeAlert) return;

    if (remainingSeconds <= 0) {
      hapticAlert();
      setEscalated(true);
      setSirenMode('quiet');
      postSingleEvent(
        'ESCALATED',
        `missed_checkin lat=${userLocation.lat.toFixed(6)} lon=${userLocation.lon.toFixed(6)}`,
        userLocation,
      );
      return;
    }

    if (hasCheckedInOnce && remainingSeconds < 10 && sirenMode === 'paused') {
      setSirenMode('quiet');
    }

    const timer = window.setTimeout(() => {
      setRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [
    screen,
    escalated,
    remainingSeconds,
    hasCheckedInOnce,
    sirenMode,
    serviceState.activeAlert,
    userLocation,
    postSingleEvent,
  ]);

  const handleAlertCenterChange = (nextMode: AlertCenterMode) => {
    setAlertCenter(nextMode);
    if (nextMode === 'LIVE') {
      setAlertRadiusKm(15);
      return;
    }
    const preset = SCENARIO_PRESETS.find((s) => s.id === nextMode);
    if (preset) {
      setDisasterType(preset.payload.type);
      setAlertRadiusKm(preset.payload.region.radius_km);
      setManualGpsLocation(preset.defaultUserLocation, 'preset');
      return;
    }
    const city = PYTHON_CITIES.find((c) => c.id === nextMode);
    if (city) {
      setAlertRadiusKm(15);
      setManualGpsLocation({ lat: city.lat, lon: city.lon }, 'preset');
    }
  };

  const handleBroadcastActive = async () => {
    if (isDispatching) return;
    setIsDispatching(true);
    const nonce = alertNonce;
    setAlertNonce((n) => n + 1);
    try {
      const payload = await buildPayloadWithLiveGeo(nonce, userLocation);
      const raw = JSON.stringify(payload);
      const sig = hmacSha256Hex(raw);
      runPollPipeline({ status: 'ACTIVE', payload: raw, sig });
    } finally {
      setIsDispatching(false);
    }
  };

  const handleBadSignature = () => {
    const payload = buildBasePayload(alertNonce);
    setAlertNonce((n) => n + 1);
    const raw = JSON.stringify(payload);
    runPollPipeline({ status: 'ACTIVE', payload: raw, sig: '0000bad0signature0000' });
  };

  const handleTestOutOfRegion = () => {
    const payload = buildBasePayload(alertNonce);
    setAlertNonce((n) => n + 1);
    const raw = JSON.stringify(payload);
    const sig = hmacSha256Hex(raw);
    const outLoc = outsideZoneLocation;
    setManualGpsLocation(outLoc, 'manual');
    runPollPipeline({ status: 'ACTIVE', payload: raw, sig }, outLoc);
  };

  const handleSendAllClear = () => {
    const targetId = serviceState.activeAlert?.alert_id;
    if (!targetId) return;
    const clearSig = hmacSha256Hex(`${targetId}|CLEARED`);
    runPollPipeline({
      status: 'CLEARED',
      alert_id: targetId,
      clear_sig: clearSig,
    });
  };

  const handleSlideConfirm = () => {
    const alert = serviceState.activeAlert;
    if (!alert) return;
    const nearest = findNearestShelter(userLocation.lat, userLocation.lon, alert.shelters);
    const batch: Omit<DeviceEvent, 'id' | 'timestamp'>[] = [
      {
        device: DEVICE_ID,
        event: 'SLIDER_CONFIRMED',
        detail: `interval_s=${alert.checkin_interval_s}`,
        lat: Number(userLocation.lat.toFixed(6)),
        lon: Number(userLocation.lon.toFixed(6)),
      },
    ];
    if (nearest) {
      batch.push({
        device: DEVICE_ID,
        event: 'NEAREST_SHELTER',
        detail: `shelter=${nearest.shelter.name} distance_km=${nearest.distanceKm.toFixed(2)}`,
        lat: Number(userLocation.lat.toFixed(6)),
        lon: Number(userLocation.lon.toFixed(6)),
      });
    }
    appendEvents(batch);
    setScreen('screen2');
    setSirenMode('quiet');
    setRemainingSeconds(alert.checkin_interval_s);
    setHasCheckedInOnce(false);
    setEscalated(false);
  };

  const handleCheckIn = () => {
    const alert = serviceState.activeAlert;
    if (!alert) return;
    postSingleEvent('CHECKIN', `interval_s=${alert.checkin_interval_s}`, userLocation);
    setHasCheckedInOnce(true);
    setEscalated(false);
    setRemainingSeconds(alert.checkin_interval_s);
    setSirenMode('paused');
  };

  const handleDownloadProject = () => {
    hapticConfirm();
    const zipBytes = createZipBytes(
      ANDROID_PROJECT_FILES.map((file) => ({
        path: `ArgoAlert/${file.path}`,
        content: file.content,
      })),
    );
    const blob = new Blob([zipBytes as unknown as BlobPart], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'argo-alert-android.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const openSourceFileInWorkbench = (fileId: string) => {
    hapticTap();
    setSourceFileId(fileId);
    setActiveTab('source');
    document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleCopyClone = async () => {
    hapticConfirm();
    try {
      await navigator.clipboard.writeText(GITHUB_CLONE_CMD);
      setCopiedClone(true);
      window.setTimeout(() => setCopiedClone(false), 1600);
    } catch {
      // Ignore clipboard failure
    }
  };

  const activeRegionCenter = serviceState.activeAlert?.region.center ?? targetRegionCenter;
  const activeRegionRadius = serviceState.activeAlert?.region.radius_km ?? alertRadiusKm;
  const distanceToCenterKm = haversineKm(
    userLocation.lat,
    userLocation.lon,
    activeRegionCenter.lat,
    activeRegionCenter.lon,
  );
  const insideRegion = distanceToCenterKm <= activeRegionRadius;

  const fieldInputClass =
    'mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-400 focus:outline-none dark:border-[#1E2636] dark:bg-[#07090D] dark:text-[#D4DCE6] dark:focus:border-slate-600';

  return (
    <div
      id="top"
      className="min-h-screen overflow-x-clip bg-[#F7F8FA] text-slate-900 dark:bg-[#050608] dark:text-[#D4DCE6]"
    >
      {/* Top Bar Contract: 3 zones — Wordmark | 4 concise nav links | Theme toggle + primary CTA */}
      <header className="sticky top-0 z-[1200] border-b border-slate-200/90 bg-[#F7F8FA]/95 backdrop-blur-sm dark:border-[#161C27] dark:bg-[#050608]/95">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-3.5 py-2 md:gap-8 md:px-8 md:py-3">
          <a
            href="#top"
            onClick={() => hapticTap()}
            className="text-[15px] sm:text-base font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0 dark:text-[#E2E8F0]"
          >
            Argo Navis
          </a>

          <nav
            aria-label="Primary sections"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-400"
          >
            <a
              href="#protocol"
              className="transition-colors hover:text-slate-900 hover:underline underline-offset-4 dark:hover:text-[#E2E8F0] whitespace-nowrap shrink-0"
            >
              Protocol
            </a>
            <a
              href="#demo"
              className="transition-colors hover:text-slate-900 hover:underline underline-offset-4 dark:hover:text-[#E2E8F0] whitespace-nowrap shrink-0"
            >
              Live Demo
            </a>
            <a
              href="#architecture"
              className="transition-colors hover:text-slate-900 hover:underline underline-offset-4 dark:hover:text-[#E2E8F0] whitespace-nowrap shrink-0"
            >
              Architecture
            </a>
            <a
              href="#repository"
              className="transition-colors hover:text-slate-900 hover:underline underline-offset-4 dark:hover:text-[#E2E8F0] whitespace-nowrap shrink-0"
            >
              Repository
            </a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <ThemeToggleButton />

            <a
              href="#demo"
              onClick={() => hapticTap()}
              className="inline-flex min-h-[34px] sm:min-h-[38px] items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 active:scale-95 dark:bg-red-700 dark:hover:bg-red-600 whitespace-nowrap shrink-0"
            >
              <span>Live Demo</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </header>

      {/* Section 1: Editorial Hero + Capability Strip */}
      <section className="border-b border-slate-200 dark:border-[#161C27]">
        <div className="mx-auto max-w-[1440px] px-3.5 py-6 sm:px-4 sm:py-10 md:px-8 md:py-16">
          <div className="grid grid-cols-1 items-stretch gap-5 sm:gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="flex flex-col justify-center lg:col-span-6">
              <p className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400">
                <span>com.argo.alert</span>
                <span className="mx-1.5 sm:mx-2" aria-hidden="true">·</span>
                <span>Android Device Owner</span>
                <span className="mx-1.5 sm:mx-2" aria-hidden="true">·</span>
                <span>Python Alert Gateway</span>
              </p>

              <h1
                className="mt-2.5 sm:mt-4 max-w-2xl font-extrabold tracking-tight text-slate-900 dark:text-[#E2E8F0]"
                style={{ fontSize: 'clamp(1.75rem, 3.8vw, 3.5rem)', lineHeight: 1.08, textWrap: 'balance' }}
              >
                Emergency Alerts That Override Every Distraction
              </h1>

              <p className="mt-2.5 sm:mt-5 max-w-[65ch] text-[13.5px] sm:text-base leading-relaxed text-slate-600 dark:text-slate-400">
                Argo Navis is an OEM life-safety alert layer built in Kotlin and Jetpack Compose with a
                Python companion gateway. Devices poll every two seconds, verify HMAC-SHA256 alert
                signatures, evaluate Haversine geofences against active GPS fixes, and guide citizens
                along real pedestrian walking routes to nearby shelters.
              </p>

              <div className="mt-4 sm:mt-7 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
                <a
                  href="#demo"
                  onClick={() => hapticTap()}
                  className="inline-flex min-h-[38px] sm:min-h-[42px] items-center justify-center gap-1.5 sm:gap-2 rounded-lg bg-red-600 px-3 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-white transition-colors hover:bg-red-700 active:scale-95 dark:bg-red-700 dark:hover:bg-red-600 whitespace-nowrap"
                >
                  <span className="sm:hidden">Live Demo</span>
                  <span className="hidden sm:inline">Explore Interactive Demo</span>
                  <ArrowRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
                </a>
                <button
                  type="button"
                  onClick={handleDownloadProject}
                  className="inline-flex min-h-[38px] sm:min-h-[42px] items-center justify-center gap-1.5 sm:gap-2 rounded-lg border border-slate-300 bg-white px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-medium text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50 active:scale-95 dark:border-[#222B3B] dark:bg-[#0C1017] dark:text-[#D4DCE6] dark:hover:border-slate-600 dark:hover:bg-[#131924] whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
                  <span className="sm:hidden">Android (.zip)</span>
                  <span className="hidden sm:inline">Download Android (.zip)</span>
                </button>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="relative h-full min-h-[185px] max-h-[220px] sm:min-h-[280px] sm:max-h-none overflow-hidden rounded-xl border border-slate-200 bg-slate-900 dark:border-[#1B2230] dark:bg-[#080B10]">
                {!heroImgFailed ? (
                  <img
                    src={heroArgoImg}
                    alt="Argo Navis emergency responder mobile handset showing topographic vector route and green shelter marker"
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgFailed(true)}
                    className="h-full w-full object-cover dark:brightness-90"
                  />
                ) : (
                  <div className="flex h-full min-h-[185px] sm:min-h-[300px] flex-col items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950 p-6 sm:p-8 text-center text-slate-200">
                    <MapPin className="h-8 w-8 sm:h-10 sm:w-10 text-emerald-400" aria-hidden="true" />
                    <p className="mt-2 sm:mt-3 text-sm font-semibold">Argo Navis Responder View</p>
                    <p className="mt-1 max-w-sm text-xs text-slate-400">
                      Lock-screen emergency takeover paired with live satellite shelter routing.
                    </p>
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3.5 pt-8 pb-2.5 sm:px-5 sm:pt-10 sm:pb-4">
                  <p className="font-mono text-[10px] sm:text-[11px] text-slate-200 truncate">
                    LOCKED_BOOT_COMPLETED · USAGE_ALARM Siren · Overpass &amp; OSRM Evacuation Routing
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 4-column verified system specifications below Hero split */}
          <div className="mt-5 sm:mt-10 grid grid-cols-2 divide-x divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-4 lg:divide-y-0 dark:divide-[#1A2130] dark:border-[#1B2230] dark:bg-[#0C1017]">
            {[
              {
                value: '2s Loop',
                label: 'Background Poll Cadence',
                note: 'AlertService queries GET /api/device/poll with live GPS & battery',
              },
              {
                value: 'HMAC-SHA256',
                label: 'Payload & Clear Signing',
                note: 'Constant-time signature check before parsing alert payloads',
              },
              {
                value: '<= 5% Battery',
                label: 'Reserve Power Mode',
                note: 'Engages RESERVE_POWER_ACTIVE telemetry when charge is critical',
              },
              {
                value: '5.0 km/h',
                label: 'Pedestrian Route Speed',
                note: 'OSRM foot paths to nearby OSM amenities with offline metric grid',
              },
            ].map((spec) => (
              <div key={spec.label} className="p-3 sm:p-5">
                <p className="font-mono text-sm sm:text-lg font-bold text-slate-900 tabular-nums dark:text-[#E2E8F0]">
                  {spec.value}
                </p>
                <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm font-semibold text-slate-800 dark:text-[#C9D1DC]">
                  {spec.label}
                </p>
                <p className="mt-0.5 sm:mt-1 text-[11px] sm:text-xs leading-snug sm:leading-relaxed text-slate-500 dark:text-slate-400">
                  {spec.note}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Section 2: 6-Stage Verification & Takeover Protocol */}
      <section
        id="protocol"
        className="border-b border-slate-200 bg-white dark:border-[#161C27] dark:bg-[#080B10]"
      >
        <div className="mx-auto max-w-[1440px] px-3.5 py-8 sm:px-4 sm:py-12 md:px-8 md:py-14">
          <div className="max-w-2xl">
            <p className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400">
              End-to-End Verification Pipeline
            </p>
            <h2
              className="mt-1.5 sm:mt-2 font-bold tracking-tight text-slate-900 dark:text-[#E2E8F0]"
              style={{ fontSize: 'clamp(1.35rem, 2.5vw, 2.25rem)', textWrap: 'balance' }}
            >
              Six Deterministic Gates From Poll to Evacuation
            </h2>
            <p className="mt-2 sm:mt-3 text-xs sm:text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Every state transition is audited identically in the Android{' '}
              <code className="font-mono text-slate-800 dark:text-slate-200">AlertService.kt</code>{' '}
              loop and the live simulator below, posting ordered telemetry to{' '}
              <code className="font-mono text-slate-800 dark:text-slate-200">
                /api/device/event
              </code>
              .
            </p>
          </div>

          <div className="mt-5 sm:mt-10 grid grid-cols-1 gap-5 sm:gap-8 lg:grid-cols-12">
            <ol className="divide-y divide-slate-200 border-y border-slate-200 lg:col-span-7 dark:divide-[#19202D] dark:border-[#19202D]">
              {PROTOCOL_STAGES.map((stage) => (
                <li key={stage.index} className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[72px_1fr] sm:gap-4 sm:py-4">
                  <div className="flex items-baseline gap-2 sm:block">
                    <span className="font-mono text-xs sm:text-sm font-bold text-red-600 tabular-nums dark:text-red-400">
                      {stage.index}.
                    </span>
                    <span className="font-mono text-[10px] text-slate-500 sm:hidden dark:text-slate-400">
                      {stage.event}
                    </span>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-[13px] sm:text-sm font-semibold text-slate-900 dark:text-[#E2E8F0]">
                        {stage.title}
                      </h3>
                      <span className="hidden sm:inline font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {stage.event}
                      </span>
                    </div>
                    <p className="mt-0.5 sm:mt-1 text-[11.5px] sm:text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {stage.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="flex flex-col justify-between gap-3.5 sm:gap-4 rounded-xl border border-slate-200 bg-[#F7F8FA] p-3.5 sm:p-5 lg:col-span-5 dark:border-[#1B2230] dark:bg-[#0C1017]">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E2E8F0]">
                  Gateway Wire Contract
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  The Android layer communicates with{' '}
                  <code className="font-mono text-slate-800 dark:text-slate-200">argo_sim.py</code>{' '}
                  over HTTP (<code className="font-mono">10.0.2.2:8000</code> in Android Emulator)
                  with cleartext traffic scoped strictly to the emulator loopback host.
                </p>

                <div className="mt-3 sm:mt-4 space-y-2.5 sm:space-y-3">
                  <div>
                    <p className="font-mono text-[10px] sm:text-[11px] font-semibold text-blue-700 dark:text-sky-400 break-all">
                      GET /api/device/poll?device=emu1&amp;lat=..&amp;lon=..&amp;battery=..&amp;src=gps
                    </p>
                    <pre className="mt-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2.5 sm:p-3 font-mono text-[10px] sm:text-[11px] leading-relaxed text-slate-800 dark:border-[#161D2B] dark:bg-[#06080B] dark:text-[#C5D0DF]">
{`{
  "status": "ACTIVE",
  "payload": "{alert_id, type, region, shelters, ...}",
  "sig": "hmac_sha256_hex(raw_payload)"
}`}
                    </pre>
                  </div>

                  <div>
                    <p className="font-mono text-[10px] sm:text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                      POST /api/device/event
                    </p>
                    <pre className="mt-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2.5 sm:p-3 font-mono text-[10px] sm:text-[11px] leading-relaxed text-slate-800 dark:border-[#161D2B] dark:bg-[#06080B] dark:text-[#C5D0DF]">
{`{
  "device": "emu1",
  "event": "NEAREST_SHELTER",
  "detail": "shelter=Marunouchi Plaza distance_km=0.39",
  "lat": 35.6812,
  "lon": 139.7671
}`}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 pt-2.5 sm:pt-3 text-xs text-slate-600 dark:border-[#1B2230] dark:text-slate-400">
                <span>Test each gate interactively below</span>
                <a
                  href="#demo"
                  onClick={() => hapticTap()}
                  className="inline-flex items-center gap-1 font-semibold text-red-600 hover:underline dark:text-red-400"
                >
                  <span>Jump to Simulator</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Interactive Live Demo Workbench */}
      <main id="demo" className="border-b border-slate-200 dark:border-[#161C27]">
        <div className="mx-auto max-w-[1440px] px-3.5 py-7 sm:px-4 sm:py-10 md:px-8 md:py-12">
          {/* Workbench Header & Mode Switcher */}
          <div className="mb-4 sm:mb-6 flex flex-wrap items-center justify-between gap-2.5 sm:gap-4 border-b border-slate-200 pb-3 sm:pb-4 dark:border-[#1B2230]">
            <div>
              <h2
                className="font-bold tracking-tight text-slate-900 dark:text-[#E2E8F0]"
                style={{ fontSize: 'clamp(1.2rem, 2.2vw, 1.85rem)' }}
              >
                {activeTab === 'simulator' && 'Live Interactive Simulator & Satellite Control Room'}
                {activeTab === 'source' && 'Complete Android Kotlin & Jetpack Compose Source'}
                {activeTab === 'setup' && 'Device Owner Provisioning & API Reference'}
              </h2>
              <p className="mt-0.5 sm:mt-1 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                <span>com.argo.alert</span>
                <span className="mx-1.5 sm:mx-2" aria-hidden="true">·</span>
                <span>Satellite + OSM Shelters &amp; OSRM Foot Routes</span>
                <span className="mx-1.5 sm:mx-2" aria-hidden="true">·</span>
                <span>{ANDROID_PROJECT_FILES.length} Android project files</span>
              </p>
            </div>

            <div className="flex w-full sm:w-auto flex-wrap items-center justify-between sm:justify-end gap-2">
              <div
                role="tablist"
                aria-label="Workbench mode"
                className="flex flex-1 sm:flex-initial items-center gap-0.5 sm:gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 sm:p-1 dark:border-[#1E2636] dark:bg-[#0C1017]"
              >
                {(
                  [
                    { id: 'simulator', label: 'Simulator', desktopLabel: 'Device Simulator' },
                    { id: 'source', label: 'Source', desktopLabel: 'Android Source' },
                    { id: 'setup', label: 'Setup', desktopLabel: 'Setup Guide' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    onClick={() => {
                      hapticTap();
                      setActiveTab(tab.id);
                    }}
                    className={`flex-1 sm:flex-initial rounded-md px-2 sm:px-3 py-1.5 text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-[#182030] dark:text-[#E2E8F0]'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-[#D4DCE6]'
                    }`}
                  >
                    <span className="sm:hidden">{tab.label}</span>
                    <span className="hidden sm:inline">{tab.desktopLabel}</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleDownloadProject}
                aria-label="Download Android Project ZIP"
                className="inline-flex min-h-[34px] sm:min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-semibold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 active:scale-95 dark:border-[#1E2636] dark:bg-[#0C1017] dark:text-[#D4DCE6] dark:hover:border-slate-600 dark:hover:bg-[#131924] whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sm:hidden">ZIP</span>
                <span className="hidden sm:inline">Download ZIP</span>
              </button>
            </div>
          </div>

          {activeTab === 'simulator' && (
            <>
              {/* Compact Mobile Simulator View Switcher (< lg) */}
              <div
                role="tablist"
                aria-label="Mobile simulator panes"
                className="mb-3 grid grid-cols-4 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 lg:hidden dark:border-[#1E2636] dark:bg-[#0C1017]"
              >
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'controls', label: 'Controls' },
                    { id: 'phone', label: 'Phone' },
                    { id: 'map', label: 'Map & Log' },
                  ] as const
                ).map((pane) => (
                  <button
                    key={pane.id}
                    type="button"
                    role="tab"
                    aria-selected={mobileSimPane === pane.id}
                    onClick={() => {
                      hapticTap();
                      setMobileSimPane(pane.id);
                    }}
                    className={`rounded-md py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                      mobileSimPane === pane.id
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-[#182030] dark:text-[#E2E8F0]'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-[#D4DCE6]'
                    }`}
                  >
                    {pane.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-[330px_348px_minmax(420px,1fr)]">
                {/* Left Column: Dispatch Server & Device Sensor Controls */}
                <section
                  className={`${
                    mobileSimPane === 'all' || mobileSimPane === 'controls' ? 'block' : 'hidden lg:block'
                  } space-y-3 sm:space-y-4 rounded-xl border border-slate-200 bg-white p-3 sm:p-4 dark:border-[#1B2230] dark:bg-[#0C1017]`}
                >
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E2E8F0]">
                    Dispatch Control
                  </h3>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    http://10.0.2.2:8000/api/device/poll
                  </p>

                  {/* Alert Centre Selector */}
                  <div className="mt-3 space-y-2.5">
                    <div>
                      <label
                        htmlFor="alert-center-select"
                        className="block text-[11px] font-medium text-slate-600 dark:text-slate-400"
                      >
                        Alert Centre
                      </label>
                      <select
                        id="alert-center-select"
                        value={alertCenter}
                        onChange={(e) => handleAlertCenterChange(e.target.value)}
                        className={fieldInputClass}
                      >
                        <option value="LIVE">My Device GPS (Current Location)</option>
                        <optgroup label="Scenarios">
                          {SCENARIO_PRESETS.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Control Room Cities">
                          {PYTHON_CITIES.map((city) => (
                            <option key={city.id} value={city.id}>
                              {city.name} ({city.lat.toFixed(2)}, {city.lon.toFixed(2)})
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label
                          htmlFor="disaster-type-select"
                          className="block text-[11px] font-medium text-slate-600 dark:text-slate-400"
                        >
                          Disaster Type
                        </label>
                        <select
                          id="disaster-type-select"
                          value={disasterType}
                          onChange={(e) => setDisasterType(e.target.value)}
                          className={fieldInputClass}
                        >
                          {DISASTER_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label
                          htmlFor="alert-radius-input"
                          className="block text-[11px] font-medium text-slate-600 dark:text-slate-400"
                        >
                          Radius (km)
                        </label>
                        <input
                          id="alert-radius-input"
                          type="number"
                          min={1}
                          max={200}
                          value={alertRadiusKm}
                          onChange={(e) => {
                            const v = Number.parseFloat(e.target.value);
                            if (!Number.isNaN(v) && v >= 1) setAlertRadiusKm(v);
                          }}
                          className={`${fieldInputClass} font-mono tabular-nums`}
                        />
                      </div>
                    </div>

                    <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-[#1E2636] dark:bg-[#07090D] dark:text-slate-300">
                      <span>Live OSM Shelters &amp; Foot Routes</span>
                      <input
                        type="checkbox"
                        checked={useLiveOsmLookup}
                        onChange={(e) => setUseLiveOsmLookup(e.target.checked)}
                        className="h-4 w-4 accent-emerald-600"
                      />
                    </label>
                  </div>

                  {/* Primary & Edge-case Actions */}
                  <div className="mt-3.5 space-y-2">
                    <button
                      type="button"
                      onClick={handleBroadcastActive}
                      disabled={isDispatching}
                      className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-70 dark:bg-red-700 dark:hover:bg-red-600"
                    >
                      {isDispatching ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                      )}
                      <span>
                        {isDispatching ? 'Fetching Shelters & Routes...' : 'Broadcast Active Alert'}
                      </span>
                    </button>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={handleBadSignature}
                        className="flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-[#222B3B] dark:bg-[#07090D] dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-[#131924] dark:hover:text-[#E2E8F0]"
                      >
                        <ShieldX className="h-3.5 w-3.5 text-red-600 dark:text-red-400" aria-hidden="true" />
                        <span>Bad Signature</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleTestOutOfRegion}
                        className="flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-[#222B3B] dark:bg-[#07090D] dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-[#131924] dark:hover:text-[#E2E8F0]"
                      >
                        <MapPinOff className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                        <span>Out of Region</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleSendAllClear}
                      disabled={!serviceState.activeAlert}
                      className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-emerald-800/60 dark:bg-emerald-950/35 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      <span>Send Signed All Clear</span>
                    </button>
                  </div>
                </div>

                <hr className="border-slate-200 dark:border-[#1B2230]" />

                {/* GPS & Battery Telemetry Controls */}
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E2E8F0]">
                      Device GPS &amp; Sensors
                    </h3>
                    <span
                      className={`font-mono text-xs font-semibold tabular-nums ${
                        insideRegion
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {distanceToCenterKm.toFixed(1)} km / {activeRegionRadius} km
                    </span>
                  </div>

                  {/* Live Geolocation Toggle */}
                  <button
                    type="button"
                    onClick={handleToggleLiveGps}
                    aria-pressed={gpsWatchActive}
                    className={`flex min-h-[36px] w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      gpsWatchActive
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700/70 dark:bg-emerald-950/35 dark:text-emerald-200'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 dark:border-[#222B3B] dark:bg-[#07090D] dark:text-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Navigation
                        className={`h-3.5 w-3.5 ${
                          gpsWatchActive
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-blue-600 dark:text-sky-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span>{gpsWatchActive ? 'Live Browser GPS Active' : 'Use My Live GPS'}</span>
                    </span>
                    <span className="font-mono text-[10px] uppercase">
                      {gpsWatchActive ? 'STOP' : 'START'}
                    </span>
                  </button>

                  {gpsError && (
                    <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/35 dark:text-amber-200">
                      {gpsError}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor="gps-lat"
                        className="block text-[11px] font-medium text-slate-600 dark:text-slate-400"
                      >
                        GPS Latitude
                      </label>
                      <input
                        id="gps-lat"
                        type="number"
                        step="0.001"
                        value={userLocation.lat}
                        onChange={(e) => {
                          const val = Number.parseFloat(e.target.value);
                          if (!Number.isNaN(val) && val >= -90 && val <= 90) {
                            setManualGpsLocation({ ...userLocation, lat: val }, 'manual');
                          }
                        }}
                        className={`${fieldInputClass} font-mono tabular-nums`}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="gps-lon"
                        className="block text-[11px] font-medium text-slate-600 dark:text-slate-400"
                      >
                        GPS Longitude
                      </label>
                      <input
                        id="gps-lon"
                        type="number"
                        step="0.001"
                        value={userLocation.lon}
                        onChange={(e) => {
                          const val = Number.parseFloat(e.target.value);
                          if (!Number.isNaN(val) && val >= -180 && val <= 180) {
                            setManualGpsLocation({ ...userLocation, lon: val }, 'manual');
                          }
                        }}
                        className={`${fieldInputClass} font-mono tabular-nums`}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const insideLoc = selectedScenario
                          ? selectedScenario.defaultUserLocation
                          : targetRegionCenter;
                        setManualGpsLocation(insideLoc, 'preset');
                      }}
                      className="flex-1 rounded-lg border border-slate-200 bg-slate-50 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300 hover:text-slate-900 dark:border-[#222B3B] dark:bg-[#07090D] dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-[#E2E8F0]"
                    >
                      Inside Zone
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualGpsLocation(outsideZoneLocation, 'manual')}
                      className="flex-1 rounded-lg border border-slate-200 bg-slate-50 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300 hover:text-slate-900 dark:border-[#222B3B] dark:bg-[#07090D] dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-[#E2E8F0]"
                    >
                      Outside Zone
                    </button>
                  </div>

                  {/* Battery percentage */}
                  <div>
                    <div className="flex items-center justify-between text-xs">
                      <label
                        htmlFor="battery-range"
                        className="font-medium text-slate-700 dark:text-slate-300"
                      >
                        BatteryManager Level
                      </label>
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          batteryPct <= 5
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        {batteryPct}%{batteryPct <= 5 ? ' (Reserve)' : ''}
                      </span>
                    </div>
                    <input
                      id="battery-range"
                      type="range"
                      min={1}
                      max={100}
                      value={batteryPct}
                      onChange={(e) => setBatteryPct(Number(e.target.value))}
                      className="mt-2 h-6 w-full cursor-pointer touch-none accent-red-600"
                    />
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          hapticTap();
                          setBatteryPct(4);
                        }}
                        className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 hover:border-amber-400 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:border-amber-500/60"
                      >
                        Set 4% Reserve
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          hapticTap();
                          setBatteryPct(75);
                        }}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:border-slate-300 dark:border-[#222B3B] dark:bg-[#07090D] dark:text-slate-300 dark:hover:border-slate-600"
                      >
                        Reset 75%
                      </button>
                    </div>
                  </div>

                  {/* Check-in countdown duration */}
                  <div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        Check-In Interval
                      </span>
                      <span className="font-mono text-slate-500 tabular-nums dark:text-slate-400">
                        {checkinIntervalS}s
                      </span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#07090D]">
                      {[15, 30, 60].map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => {
                            hapticTap();
                            setCheckinIntervalS(sec);
                          }}
                          className={`rounded-md py-1 font-mono text-xs font-medium tabular-nums transition-colors ${
                            checkinIntervalS === sec
                              ? 'bg-white text-slate-900 shadow-xs dark:bg-[#161D2B] dark:text-[#E2E8F0]'
                              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-[#D4DCE6]'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <hr className="border-slate-200 dark:border-[#1B2230]" />

                {/* Audio, Flashing & Haptics Controls */}
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E2E8F0]">
                    Siren, Flash &amp; Haptics
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      hapticTap();
                      setAudioEnabled((prev) => !prev);
                    }}
                    aria-pressed={audioEnabled}
                    className={`flex min-h-[38px] w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      audioEnabled
                        ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-200'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 dark:border-[#222B3B] dark:bg-[#07090D] dark:text-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      {audioEnabled ? (
                        <Volume2 className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                      ) : (
                        <VolumeX className="h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                      )}
                      <span>Web Audio Two-Tone Siren</span>
                    </span>
                    <span className="font-mono text-[11px]">{audioEnabled ? 'ON' : 'MUTED'}</span>
                  </button>

                  <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-[#1E2636] dark:bg-[#07090D] dark:text-slate-300">
                    <span>Screen 1 Red Flash (Deaf Accessibility)</span>
                    <input
                      type="checkbox"
                      checked={flashingEnabled}
                      onChange={(e) => {
                        hapticTap();
                        setFlashingEnabled(e.target.checked);
                      }}
                      className="h-4 w-4 accent-red-600"
                    />
                  </label>

                  <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-[#1E2636] dark:bg-[#07090D] dark:text-slate-300">
                    <span>Touch Haptics (Mobile Vibration)</span>
                    <input
                      type="checkbox"
                      checked={hapticsEnabled}
                      onChange={(e) => setHapticsEnabled(e.target.checked)}
                      className="h-4 w-4 accent-emerald-600"
                    />
                  </label>
                </div>
              </section>

              {/* Center Column: Interactive Android Emulator */}
              <section
                className={`${
                  mobileSimPane === 'all' || mobileSimPane === 'phone' ? 'flex' : 'hidden lg:flex'
                } flex-col items-center justify-start py-1`}
              >
                <AndroidEmulator
                  screen={screen}
                  activeAlert={serviceState.activeAlert}
                  userLocation={userLocation}
                  gpsAccuracyM={gpsAccuracyM}
                  gpsSource={gpsSource}
                  deviceStatus={deviceStatus}
                  batteryPct={batteryPct}
                  reservePowerActive={serviceState.reservePowerActive}
                  sirenMode={sirenMode}
                  flashingEnabled={flashingEnabled}
                  remainingSeconds={remainingSeconds}
                  escalated={escalated}
                  onSlideConfirm={handleSlideConfirm}
                  onCheckIn={handleCheckIn}
                />
              </section>

              {/* Right Column: Live Satellite Map + Device Telemetry + Event Stream */}
              <div
                className={`${
                  mobileSimPane === 'all' || mobileSimPane === 'map' ? 'flex' : 'hidden lg:flex'
                } flex-col gap-3 sm:gap-4`}
              >
                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#1B2230] dark:bg-[#0C1017]">
                  <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 border-b border-slate-200 px-3 py-2.5 sm:px-4 sm:py-3 dark:border-[#1B2230]">
                    <div className="flex items-center gap-2">
                      <MapPin
                        className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                        aria-hidden="true"
                      />
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E2E8F0]">
                        Control Room Satellite Map
                      </h3>
                    </div>
                    <div className="font-mono text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400">
                      {serviceState.activeAlert
                        ? `${serviceState.activeAlert.shelters.length} shelters · ${
                            serviceState.activeAlert.shelter_source ?? 'Preset'
                          }`
                        : 'Standby · Geofence & GPS preview'}
                    </div>
                  </div>

                  <div className="h-[245px] sm:h-[360px] w-full">
                    <SatelliteEvacuationMap
                      userLocation={userLocation}
                      gpsAccuracyM={gpsAccuracyM}
                      gpsSource={gpsSource}
                      deviceStatus={deviceStatus}
                      activeAlert={serviceState.activeAlert}
                      previewRegion={previewRegion}
                      allowMapClickToSetGps={true}
                      onMapClickGps={(pt) => setManualGpsLocation(pt, 'manual')}
                      testId="control-room-satellite-map"
                    />
                  </div>
                </section>

                {/* Devices Table Strip */}
                <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:px-4 sm:py-3 dark:border-[#1B2230] dark:bg-[#0C1017]">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-[10px] sm:text-[11px] text-slate-500 dark:border-[#1B2230] dark:text-slate-400">
                        <th className="pb-1.5 sm:pb-2 font-medium">Device</th>
                        <th className="pb-1.5 sm:pb-2 font-medium">Status</th>
                        <th className="pb-1.5 sm:pb-2 font-medium">Battery</th>
                        <th className="pb-1.5 sm:pb-2 font-medium">GPS</th>
                        <th className="pb-1.5 sm:pb-2 font-medium">Location</th>
                        <th className="pb-1.5 sm:pb-2 font-medium text-right">Check-In</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="font-mono text-[10px] sm:text-[11px] text-slate-700 tabular-nums dark:text-slate-300">
                        <td className="pt-1.5 sm:pt-2 font-semibold text-slate-900 dark:text-[#E2E8F0]">
                          {DEVICE_ID}
                        </td>
                        <td className="pt-1.5 sm:pt-2">
                          <span
                            data-testid="device-status-badge"
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_BADGE_STYLE[deviceStatus]}`}
                          >
                            {deviceStatus}
                          </span>
                        </td>
                        <td className="pt-1.5 sm:pt-2">{batteryPct}%</td>
                        <td className="pt-1.5 sm:pt-2 uppercase text-slate-600 dark:text-slate-400">
                          {gpsSource}
                        </td>
                        <td className="pt-1.5 sm:pt-2">
                          {userLocation.lat.toFixed(4)}, {userLocation.lon.toFixed(4)}
                        </td>
                        <td className="pt-1.5 sm:pt-2 text-right">
                          {screen === 'screen2' && !escalated ? `${remainingSeconds}s` : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </section>

                {/* Live POST /api/device/event Stream */}
                <EventLogPanel
                  events={events}
                  onClear={() => setEvents([])}
                  className="h-[210px] sm:h-[260px]"
                />
              </div>
              </div>
            </>
          )}

          {activeTab === 'source' && (
            <SourceExplorer
              onDownloadProject={handleDownloadProject}
              selectedFileId={sourceFileId}
            />
          )}

          {activeTab === 'setup' && <SetupGuide />}
        </div>
      </main>

      {/* Section 4: System Architecture Bento Grid */}
      <section
        id="architecture"
        className="border-b border-slate-200 bg-white dark:border-[#161C27] dark:bg-[#080B10]"
      >
        <div className="mx-auto max-w-[1440px] px-3.5 py-8 sm:px-4 sm:py-12 md:px-8 md:py-14">
          <div className="max-w-2xl">
            <p className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400">
              System Architecture
            </p>
            <h2
              className="mt-1.5 sm:mt-2 font-bold tracking-tight text-slate-900 dark:text-[#E2E8F0]"
              style={{ fontSize: 'clamp(1.35rem, 2.5vw, 2.25rem)', textWrap: 'balance' }}
            >
              Zero Third-Party Android Dependencies. Pure Platform &amp; Standard Library.
            </h2>
            <p className="mt-2 sm:mt-3 text-xs sm:text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Both the Android client (<code className="font-mono">com.argo.alert</code>) and the
              Python control gateway (<code className="font-mono">argo_sim.py</code>) avoid heavy
              proprietary SDKs so emergency alerts work reliably even without Google Play Services.
            </p>
          </div>

          <div className="mt-5 sm:mt-8 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-12">
            {ARCHITECTURE_MODULES.map((mod) => (
              <article
                key={mod.id}
                className={`${mod.span} flex flex-col justify-between rounded-xl border border-slate-200 bg-[#F7F8FA] p-4 sm:p-6 dark:border-[#1B2230] dark:bg-[#0C1017]`}
              >
                <div>
                  <p className="font-mono text-[10px] sm:text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {mod.tag}
                  </p>
                  <h3 className="mt-1.5 sm:mt-2 text-base sm:text-lg font-semibold text-slate-900 dark:text-[#E2E8F0]">
                    {mod.title}
                  </h3>
                  <p className="mt-1.5 sm:mt-2 text-xs sm:text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                    {mod.description}
                  </p>
                </div>

                <div className="mt-4 sm:mt-5 pt-3 sm:pt-4 border-t border-slate-200 dark:border-[#1B2230]">
                  {mod.fileId ? (
                    <button
                      type="button"
                      onClick={() => openSourceFileInWorkbench(mod.fileId)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:underline dark:text-red-400"
                    >
                      <span>Inspect {mod.fileId} in Source Explorer</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : (
                    <a
                      href={GITHUB_REPO_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:underline dark:text-red-400"
                    >
                      <span>View companion gateway on GitHub</span>
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Section 5: GitHub Repository & Quiet Footer */}
      <section id="repository" className="border-b border-slate-200 dark:border-[#161C27]">
        <div className="mx-auto max-w-[1440px] px-3.5 py-8 sm:px-4 sm:py-12 md:px-8 md:py-14">
          <div className="grid grid-cols-1 items-center gap-5 sm:gap-8 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 md:grid-cols-12 md:p-10 dark:border-[#1B2230] dark:bg-[#0C1017]">
            <div className="md:col-span-7">
              <p className="text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400">
                Open-Source Repository · GitHub
              </p>
              <h2
                className="mt-1.5 sm:mt-2 font-bold tracking-tight text-slate-900 dark:text-[#E2E8F0]"
                style={{ fontSize: 'clamp(1.35rem, 2.5vw, 2.25rem)', textWrap: 'balance' }}
              >
                Explore the Argo Navis Codebase
              </h2>
              <p className="mt-2 sm:mt-3 max-w-[62ch] text-xs sm:text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Access the full Kotlin &amp; Jetpack Compose Android module, Device Owner provisioning
                manifests, and the Python gateway simulator directly on GitHub or export the
                ready-to-build Android project archive.
              </p>

              <div className="mt-4 sm:mt-6 flex flex-wrap items-center gap-2 sm:gap-3">
                <a
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => hapticTap()}
                  data-testid="github-repo-primary-link"
                  className="inline-flex min-h-[38px] sm:min-h-[42px] items-center gap-2 rounded-lg bg-slate-900 px-3.5 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-white transition-colors hover:bg-slate-800 active:scale-95 dark:bg-[#E2E8F0] dark:text-[#080B10] dark:hover:bg-white whitespace-nowrap"
                >
                  <span>github.com/2pro4youx/Argo-Navis</span>
                  <ExternalLink className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
                </a>

                <button
                  type="button"
                  onClick={handleDownloadProject}
                  className="inline-flex min-h-[38px] sm:min-h-[42px] items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3.5 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-medium text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-100 active:scale-95 dark:border-[#222B3B] dark:bg-[#07090D] dark:text-[#D4DCE6] dark:hover:border-slate-600 dark:hover:bg-[#131924] whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
                  <span>Download Android (.zip)</span>
                </button>
              </div>
            </div>

            <div className="md:col-span-5">
              <div className="rounded-xl border border-slate-200 bg-[#F7F8FA] p-3.5 sm:p-4 dark:border-[#1E2636] dark:bg-[#07090D]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Clone Repository
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyClone}
                    aria-label="Copy git clone command"
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-slate-300 active:scale-95 dark:border-[#222B3B] dark:bg-[#0C1017] dark:text-slate-300 dark:hover:border-slate-600"
                  >
                    {copiedClone ? (
                      <>
                        <Check
                          className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                          aria-hidden="true"
                        />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2.5 sm:p-3 font-mono text-[11px] sm:text-xs text-slate-800 dark:border-[#161D2B] dark:bg-[#050608] dark:text-[#C5D0DF]">
                  {GITHUB_CLONE_CMD}
                </pre>
                <p className="mt-2.5 sm:mt-3 text-[11px] sm:text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  Run{' '}
                  <code className="font-mono text-slate-700 dark:text-slate-300">
                    python argo_sim.py server
                  </code>{' '}
                  alongside the Android emulator configured via ADB Device Owner.
                </p>
              </div>

              <div
                aria-labelledby="contributors-heading"
                className="mt-3 sm:mt-4 rounded-xl border border-slate-200 bg-[#F7F8FA] p-3.5 sm:p-4 dark:border-[#1E2636] dark:bg-[#07090D]"
              >
                <h3
                  id="contributors-heading"
                  className="text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Contributors
                </h3>
                <ul className="mt-2 divide-y divide-slate-200/80 rounded-lg border border-slate-200 bg-white px-3 dark:divide-[#161D2B] dark:border-[#161D2B] dark:bg-[#050608]">
                  {['Vyom Sanodiya', 'Shreyansh M. Mishra', 'Eshan Singh'].map((contributor) => (
                    <li
                      key={contributor}
                      className="py-2 text-xs sm:text-sm font-medium text-slate-800 dark:text-[#D4DCE6]"
                    >
                      {contributor}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-white dark:bg-[#050608]">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 sm:gap-4 px-3.5 py-4 sm:py-6 md:px-8 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="font-semibold text-slate-900 dark:text-[#E2E8F0]">Argo Navis</span>
            <span aria-hidden="true">·</span>
            <span>com.argo.alert</span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-6">
            <a href="#protocol" className="hover:text-slate-900 dark:hover:text-[#E2E8F0]">
              Protocol
            </a>
            <a href="#demo" className="hover:text-slate-900 dark:hover:text-[#E2E8F0]">
              Live Demo
            </a>
            <a href="#architecture" className="hover:text-slate-900 dark:hover:text-[#E2E8F0]">
              Architecture
            </a>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="github-repo-footer-link"
              className="inline-flex items-center gap-1 font-medium text-slate-800 hover:underline dark:text-[#D4DCE6]"
            >
              <span>GitHub: 2pro4youx/Argo-Navis</span>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
