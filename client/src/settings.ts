// ============================================================
// settings.ts — choices remembered on this device (localStorage).
//
// Every read and write is guarded: storage can be blocked (private windows,
// strict settings) and the app must work the same without it.
// ============================================================

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { isLanguageId, type Preferences } from './protocol.ts';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked — the choice just won't persist */
  }
}

// ── Session preferences (language, voice, class, board) ───────

const PREFS_KEY = 'guruai.preferences';

export function loadPrefs(): Preferences {
  try {
    const raw = JSON.parse(read(PREFS_KEY) ?? 'null') as Partial<Preferences> | null;
    if (raw && isLanguageId(raw.language)) {
      return { language: raw.language, voice: raw.voice, grade: raw.grade, board: raw.board };
    }
  } catch {
    /* corrupt — use defaults */
  }
  return { language: 'en' };
}

/** Language, voice, class and board are remembered; what to study is chosen each time. */
export function savePrefs({ language, voice, grade, board }: Preferences): void {
  write(PREFS_KEY, JSON.stringify({ language, voice, grade, board }));
}

// ── Small boolean / string settings, shared across components ─

const CHANGE_EVENT = 'guruai:setting';

function useStoredValue<T extends string>(key: string, fallback: T, valid: (v: string) => v is T) {
  const subscribe = useCallback((cb: () => void) => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) cb();
    };
    const onLocal = (e: Event) => {
      if ((e as CustomEvent<string>).detail === key) cb();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(CHANGE_EVENT, onLocal);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(CHANGE_EVENT, onLocal);
    };
  }, [key]);
  const getSnapshot = useCallback(() => {
    const v = read(key);
    return v !== null && valid(v) ? v : fallback;
  }, [key, fallback, valid]);
  const value = useSyncExternalStore(subscribe, getSnapshot);
  const set = useCallback(
    (next: T) => {
      write(key, next);
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
    },
    [key],
  );
  return [value, set] as const;
}

const isBool = (v: string): v is 'true' | 'false' => v === 'true' || v === 'false';

function useStoredBool(key: string, fallback: boolean) {
  const [v, set] = useStoredValue<'true' | 'false'>(key, fallback ? 'true' : 'false', isBool);
  return [v === 'true', useCallback((on: boolean) => set(on ? 'true' : 'false'), [set])] as const;
}

/** Spoken replies on (default) or text only. */
export const useVoiceOutput = () => useStoredBool('guruai.voiceOutput', true);

/** The developer event log tab in a session. */
export const useDevLog = () => useStoredBool('guruai.devLog', false);

/** Whether the session's side panel (notes / lesson) is open on wide screens. */
export const usePanelOpen = () => useStoredBool('guruai.panelOpen', true);

/** The sidebar collapsed to icons on wide screens. */
export const useSidebarCollapsed = () => useStoredBool('guruai.sidebarCollapsed', false);

// ── Theme ─────────────────────────────────────────────────────

export type ThemeChoice = 'light' | 'dark' | 'system';
const isTheme = (v: string): v is ThemeChoice => v === 'light' || v === 'dark' || v === 'system';

/** Light, dark, or follow the system. Applied to <html data-theme>. */
export function useTheme() {
  const [theme, setTheme] = useStoredValue<ThemeChoice>('guruai.theme', 'system', isTheme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
  return [theme, setTheme] as const;
}

/** The theme actually showing (resolves "system"), for canvas drawing. */
export function useResolvedDark(): boolean {
  const [theme] = useTheme();
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return theme === 'dark' || (theme === 'system' && systemDark);
}
