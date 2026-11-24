import { useSyncExternalStore } from 'react';

const HAPTICS_STORAGE_KEY = 'argo-haptics';

function readInitialHaptics(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(HAPTICS_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

let hapticsEnabled = readInitialHaptics();
const listeners = new Set<() => void>();

export function getHapticsEnabled(): boolean {
  return hapticsEnabled;
}

export function subscribeHaptics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHapticsEnabled(): boolean {
  return useSyncExternalStore(subscribeHaptics, getHapticsEnabled, () => true);
}

export function setHapticsEnabled(enabled: boolean): void {
  hapticsEnabled = enabled;
  try {
    window.localStorage.setItem(HAPTICS_STORAGE_KEY, String(enabled));
  } catch {
    // Ignore storage errors
  }
  listeners.forEach((listener) => listener());
  if (enabled) {
    vibrate([10]);
  }
}

export function isHapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function vibrate(pattern: number | number[]): void {
  if (!hapticsEnabled || typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;

  const navWithActivation = navigator as Navigator & {
    userActivation?: { hasBeenActive: boolean; isActive: boolean };
  };
  if (
    navWithActivation.userActivation &&
    !navWithActivation.userActivation.hasBeenActive &&
    !navWithActivation.userActivation.isActive
  ) {
    return;
  }

  try {
    navigator.vibrate(pattern);
  } catch {
    // Ignore vibration errors when blocked before user gesture
  }
}

/** Crisp 10ms light tick for buttons, tabs, toggles, and presets */
export function hapticTap(): void {
  vibrate(10);
}

/** Ultra-light 6ms detent tick for slider progress milestones */
export function hapticTick(): void {
  vibrate(6);
}

/** Tactile double-tap pulse for evacuation confirmation, check-in, and all-clear */
export function hapticConfirm(): void {
  vibrate([14, 28, 22]);
}

/** Sharp warning buzz for invalid signature or out-of-region rejection */
export function hapticReject(): void {
  vibrate([24, 32, 24]);
}

/** Urgent multi-pulse pattern for emergency alert takeover and escalation */
export function hapticAlert(): void {
  vibrate([80, 45, 110, 45, 140]);
}
