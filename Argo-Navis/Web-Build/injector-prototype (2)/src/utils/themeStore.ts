import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'argo-theme';

function readInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

let currentTheme: ThemeMode = readInitialTheme();
const listeners = new Set<() => void>();

function applyThemeToDom(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore storage errors
  }
}

// Sync initial class immediately on module load before React mounts
applyThemeToDom(currentTheme);

export function getThemeSnapshot(): ThemeMode {
  return currentTheme;
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribeTheme, getThemeSnapshot, () => 'light');
}

function commitTheme(next: ThemeMode) {
  currentTheme = next;
  applyThemeToDom(next);
  listeners.forEach((listener) => listener());
}

type ViewTransitionLike = {
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition?: () => void;
};

let activeTransition: ViewTransitionLike | null = null;

export function toggleThemeWithTransition(originEl?: HTMLElement | null): void {
  const next: ThemeMode = currentTheme === 'light' ? 'dark' : 'light';

  if (typeof document === 'undefined' || typeof window === 'undefined') {
    commitTheme(next);
    return;
  }

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const startViewTransition = (
    document as Document & {
      startViewTransition?: (callback: () => void) => ViewTransitionLike;
    }
  ).startViewTransition;

  if (!startViewTransition || prefersReducedMotion) {
    commitTheme(next);
    return;
  }

  if (activeTransition?.skipTransition) {
    try {
      activeTransition.skipTransition();
    } catch {
      // Ignore if already finished
    }
  }

  const rect = originEl?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth - 64;
  const y = rect ? rect.top + rect.height / 2 : 30;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const root = document.documentElement;
  root.style.setProperty('--theme-vt-x', `${x}px`);
  root.style.setProperty('--theme-vt-y', `${y}px`);
  root.style.setProperty('--theme-vt-r', `${endRadius}px`);
  // Disable per-element color transitions during the single-frame snapshot so the GPU wipe is crisp and lag-free
  root.classList.add('theme-switching');

  const transition = startViewTransition.call(document, () => {
    flushSync(() => {
      commitTheme(next);
    });
  });
  activeTransition = transition;

  transition.ready
    .then(() => {
      root.classList.remove('theme-switching');
    })
    .catch(() => {
      root.classList.remove('theme-switching');
    });

  transition.finished
    .finally(() => {
      root.classList.remove('theme-switching');
      if (activeTransition === transition) {
        activeTransition = null;
      }
    })
    .catch(() => {
      // Ignore aborted view transitions on rapid clicks
    });
}
