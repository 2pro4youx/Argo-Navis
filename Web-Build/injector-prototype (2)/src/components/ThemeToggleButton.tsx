import { useRef } from 'react';
import { Moon, Sun } from 'lucide-react';
import { hapticTap } from '../utils/haptics';
import { toggleThemeWithTransition, useThemeMode } from '../utils/themeStore';

export function ThemeToggleButton() {
  const theme = useThemeMode();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => {
        hapticTap();
        toggleThemeWithTransition(buttonRef.current);
      }}
      aria-label={theme === 'light' ? 'Switch to nightly dark theme' : 'Switch to light theme'}
      title={theme === 'light' ? 'Switch to nightly dark theme' : 'Switch to light theme'}
      aria-pressed={theme === 'dark'}
      data-testid="theme-toggle-button"
      className="group relative inline-flex h-[34px] w-[34px] sm:h-[38px] sm:w-[38px] items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-700 transition-colors duration-200 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-90 dark:border-[#1E2636] dark:bg-[#0C1017] dark:text-[#C9D1DC] dark:hover:border-slate-600 dark:hover:bg-[#131924] dark:hover:text-[#E2E8F0] shrink-0"
    >
      <Moon
        className={`absolute h-4 w-4 text-slate-700 transition-all duration-300 ease-out motion-reduce:transition-none ${
          theme === 'light'
            ? 'rotate-0 scale-100 opacity-100'
            : 'rotate-90 scale-50 opacity-0'
        }`}
        aria-hidden="true"
      />
      <Sun
        className={`absolute h-4 w-4 text-amber-400 transition-all duration-300 ease-out motion-reduce:transition-none ${
          theme === 'dark'
            ? 'rotate-0 scale-100 opacity-100'
            : '-rotate-90 scale-50 opacity-0'
        }`}
        aria-hidden="true"
      />
    </button>
  );
}
