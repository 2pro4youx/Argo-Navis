import { useEffect, useState } from 'react';
import { Phone, ShieldAlert, Lock, Volume2, Volume1, VolumeX } from 'lucide-react';
import { type AlertPayload, type GeoPoint } from '../core/argoEngine';
import { hapticConfirm, hapticTap } from '../utils/haptics';
import { type SirenMode } from '../utils/webSiren';
import {
  SatelliteEvacuationMap,
  type DeviceStatus,
} from './SatelliteEvacuationMap';
import { SlideToEvacuate } from './SlideToEvacuate';

export type EmulatorScreen = 'standby' | 'screen1' | 'screen2';

interface AndroidEmulatorProps {
  screen: EmulatorScreen;
  activeAlert: AlertPayload | null;
  userLocation: GeoPoint;
  gpsAccuracyM?: number | null;
  gpsSource?: 'live' | 'manual' | 'preset';
  deviceStatus?: DeviceStatus;
  batteryPct: number;
  reservePowerActive: boolean;
  sirenMode: SirenMode;
  flashingEnabled: boolean;
  remainingSeconds: number;
  escalated: boolean;
  onSlideConfirm: () => void;
  onCheckIn: () => void;
}

export function AndroidEmulator({
  screen,
  activeAlert,
  userLocation,
  gpsAccuracyM = null,
  gpsSource = 'preset',
  deviceStatus = 'IDLE',
  batteryPct,
  reservePowerActive,
  sirenMode,
  flashingEnabled,
  remainingSeconds,
  escalated,
  onSlideConfirm,
  onCheckIn,
}: AndroidEmulatorProps) {
  const [dialerOpen, setDialerOpen] = useState(false);

  useEffect(() => {
    if (screen !== 'screen1') {
      setDialerOpen(false);
    }
  }, [screen]);

  const totalSeconds = activeAlert?.checkin_interval_s ?? 30;
  const ringProgress = Math.max(0, Math.min(1, remainingSeconds / Math.max(1, totalSeconds)));
  const ringRadius = 35;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringStrokeDashoffset = ringCircumference * (1 - ringProgress);
  const ringStrokeColor = escalated
    ? '#EF4444'
    : remainingSeconds < 10
      ? '#F59E0B'
      : '#22C55E';

  return (
    <div className="flex flex-col items-center">
      {/* Device shell frame */}
      <div
        data-testid="android-emulator-frame"
        data-screen={screen}
        className="relative isolate z-0 flex h-[560px] w-[300px] sm:h-[670px] sm:w-[332px] flex-col overflow-hidden rounded-[32px] sm:rounded-[36px] border-[5px] sm:border-[6px] border-[#262E3D] bg-[#090B0E] shadow-2xl"
      >
        {/* Top hardware speaker notch */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-2.5 left-1/2 z-30 h-1.5 w-16 -translate-x-1/2 rounded-full bg-black/70"
        />

        {screen === 'standby' && (
          <div className="flex h-full flex-col justify-between bg-[#0B0F17] px-4 pt-8 pb-6 sm:px-5 sm:pt-10 sm:pb-8 text-slate-100">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-400 tabular-nums">
                <span>11:04</span>
                <span>GPS · {batteryPct}%</span>
              </div>

              <div className="mt-7 sm:mt-10 text-center">
                <p className="text-3xl sm:text-4xl font-bold tracking-tight text-white tabular-nums">11:04</p>
                <p className="mt-1 text-xs text-slate-400">Lock Screen · Standby</p>
              </div>

              {/* Persistent low-priority AlertService foreground notification */}
              <div className="mt-8 rounded-xl border border-[#232B3A] bg-[#131822] p-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <ShieldAlert className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    <span>Argo Alert</span>
                  </div>
                  <span className="text-[11px] text-slate-500">Ongoing</span>
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  OEM emergency layer active · Polling every 2s
                </p>
                <p className="mt-2 font-mono text-[11px] text-slate-500 tabular-nums">
                  {userLocation.lat.toFixed(4)}, {userLocation.lon.toFixed(4)}
                </p>
              </div>
            </div>

            <div className="space-y-2 text-center">
              <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-[#232B3A] bg-[#131822] text-slate-400">
                <Lock className="h-4 w-4" aria-hidden="true" />
              </div>
              <p className="text-xs text-slate-400">
                Waiting for signed ACTIVE alert from 10.0.2.2:8000
              </p>
            </div>
          </div>
        )}

        {screen === 'screen1' && activeAlert && (
          <div
            data-testid="alert-screen-1"
            className={`relative flex h-full flex-col items-center justify-between px-4 pt-10 pb-5 sm:px-5 sm:pt-14 sm:pb-6 text-white ${
              flashingEnabled ? 'animate-emergency-flash' : 'bg-[#B91C1C]'
            }`}
          >
            <div aria-hidden="true" className="h-2" />

            {/* Center focal anchor: White danger triangle with "!", huge alert type, severity */}
            <div className="flex flex-col items-center text-center">
              <svg
                viewBox="0 0 120 110"
                className="h-22 w-22 sm:h-28 sm:w-28"
                role="img"
                aria-label="Emergency danger warning symbol"
              >
                <path
                  d="M60 10 L110 98 L10 98 Z"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="9"
                  strokeLinejoin="round"
                />
                <text
                  x="60"
                  y="83"
                  textAnchor="middle"
                  fill="#FFFFFF"
                  fontSize="54"
                  fontWeight="900"
                  fontFamily="Plus Jakarta Sans, sans-serif"
                >
                  !
                </text>
              </svg>

              <h2 className="mt-3 sm:mt-5 text-3xl sm:text-4xl leading-none font-extrabold tracking-tight text-white uppercase">
                {activeAlert.type}
              </h2>

              <p className="mt-2 sm:mt-3 text-sm sm:text-base font-bold tracking-[0.16em] text-red-100 uppercase">
                {activeAlert.severity}
              </p>

              {reservePowerActive && (
                <p
                  data-testid="reserve-power-notice"
                  className="mt-4 text-xs font-semibold text-amber-200"
                >
                  Running on reserved 5% power
                </p>
              )}
            </div>

            {/* Bottom: Single slide-to-evacuate control + tiny Emergency call 112 link */}
            <div className="flex w-full flex-col items-center gap-4">
              <SlideToEvacuate onConfirm={onSlideConfirm} />

              <button
                type="button"
                onClick={() => {
                  hapticTap();
                  setDialerOpen(true);
                }}
                className="min-h-[36px] px-3 text-xs font-medium text-white/90 underline-offset-4 hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-white"
              >
                Emergency call 112
              </button>
            </div>

            {/* Simulated Android ACTION_DIAL sheet (avoids window.alert/window.open) */}
            {dialerOpen && (
              <div
                role="dialog"
                aria-label="Emergency dialer 112"
                className="absolute inset-x-3 bottom-3 z-40 rounded-2xl border border-slate-700 bg-[#111620] p-4 text-left shadow-xl"
              >
                <div className="flex items-center gap-2.5 text-sm font-semibold text-white">
                  <Phone className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  <span>Android Dialer · ACTION_DIAL</span>
                </div>
                <p className="mt-1.5 font-mono text-xs text-slate-300">tel:112</p>
                <p className="mt-1 text-xs text-slate-400">
                  Opens the system emergency dialer directly over lock screen.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    hapticTap();
                    setDialerOpen(false);
                  }}
                  className="mt-3 w-full rounded-lg bg-slate-800 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  Return to Alert
                </button>
              </div>
            )}
          </div>
        )}

        {screen === 'screen2' && activeAlert && (
          <div
            data-testid="alert-screen-2"
            className="relative flex h-full flex-col bg-[#090B0E] text-white"
          >
            {/* Top 60%: Satellite / Street / Offline Metric Evacuation Map */}
            <div className="relative h-[60%] w-full shrink-0 border-b border-[#232B3A]">
              <SatelliteEvacuationMap
                userLocation={userLocation}
                gpsAccuracyM={gpsAccuracyM}
                gpsSource={gpsSource}
                deviceStatus={deviceStatus}
                activeAlert={activeAlert}
                compact={true}
                testId="emulator-satellite-map"
              />
              <div className="pointer-events-none absolute top-2.5 right-2.5 z-[520] flex items-center gap-1.5 rounded bg-[#090B0E]/90 px-2 py-1 text-[10px] font-medium text-slate-200 border border-[#232B3A]">
                {sirenMode === 'quiet' && <Volume1 className="h-3 w-3 text-amber-400" />}
                {sirenMode === 'paused' && <VolumeX className="h-3 w-3 text-slate-400" />}
                {sirenMode === 'full' && <Volume2 className="h-3 w-3 text-red-400" />}
                <span>
                  {sirenMode === 'quiet'
                    ? 'Siren quiet'
                    : sirenMode === 'paused'
                      ? 'Siren paused'
                      : 'Siren active'}
                </span>
              </div>
            </div>

            {/* Bottom 40%: Disaster Type, Headline, Protocol Steps, Note */}
            <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4 pr-24">
              {escalated && (
                <p
                  data-testid="escalated-banner"
                  className="mb-1.5 text-sm font-extrabold text-red-500"
                >
                  Rescue team notified
                </p>
              )}

              {reservePowerActive && (
                <p className="mb-1 text-[11px] font-semibold text-amber-400">
                  Running on reserved 5% power
                </p>
              )}

              <p className="text-[11px] font-extrabold tracking-[0.12em] text-red-500 uppercase">
                {activeAlert.type}
              </p>
              <h3 className="mt-0.5 text-sm leading-snug font-bold text-white">
                {activeAlert.headline}
              </h3>

              <ol className="mt-2.5 space-y-1.5 text-xs leading-relaxed text-slate-200">
                {activeAlert.protocol_steps.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="w-4 shrink-0 font-mono font-bold text-blue-400 tabular-nums">
                      {idx + 1}.
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>

              {activeAlert.protocol_note && (
                <p className="mt-3 text-[10px] leading-snug text-slate-400">
                  {activeAlert.protocol_note}
                </p>
              )}
            </div>

            {/* Large circular CHECK-IN button with visible countdown ring in bottom-right corner */}
            <button
              type="button"
              onClick={() => {
                hapticConfirm();
                onCheckIn();
              }}
              aria-label={`Check in now, ${remainingSeconds} seconds remaining`}
              data-testid="checkin-button"
              className="group absolute right-3 bottom-3 flex h-[78px] w-[78px] sm:h-[84px] sm:w-[84px] items-center justify-center rounded-full bg-[#111827] shadow-lg transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <svg viewBox="0 0 84 84" className="absolute inset-0 h-full w-full -rotate-90">
                <circle
                  cx="42"
                  cy="42"
                  r={ringRadius}
                  fill="none"
                  stroke="#263042"
                  strokeWidth="5"
                />
                <circle
                  cx="42"
                  cy="42"
                  r={ringRadius}
                  fill="none"
                  stroke={ringStrokeColor}
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringStrokeDashoffset}
                />
              </svg>
              <span className="relative z-10 flex flex-col items-center leading-tight">
                <span className="text-[10px] font-extrabold tracking-wide text-white">
                  CHECK-IN
                </span>
                <span
                  className="font-mono text-base font-extrabold tabular-nums"
                  style={{ color: ringStrokeColor }}
                >
                  {remainingSeconds}s
                </span>
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Quiet caption below device */}
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
        <span>com.argo.alert</span>
        <span aria-hidden="true">·</span>
        <span>
          {screen === 'standby'
            ? 'AlertService idle'
            : screen === 'screen1'
              ? 'Lock Task · Alarm Max'
              : `Lock Task · Siren ${sirenMode}`}
        </span>
      </div>
    </div>
  );
}
