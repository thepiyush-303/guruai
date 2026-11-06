// ============================================================
// router.ts — four routes, real URLs, no dependency.
//
//   /            Home (what GuruAI is, continue or start)
//   /new         New session (language, voice, class/board)
//   /s/<id>      A session — the voice teacher itself
//   /settings    Theme, voice, notes, memory, "About you"
//
// pushState keeps the browser's Back/Forward working; the server answers
// every extension-less path with index.html (src/server.ts).
// ============================================================

import { useSyncExternalStore } from 'react';
import type { Preferences } from './protocol.ts';

export type Route =
  | { name: 'home' }
  | { name: 'new'; groupId: string | null }
  | { name: 'session'; id: string }
  | { name: 'settings' };

/** Carried in history.state when a session is started from /new. */
export interface FreshSessionState {
  fresh: true;
  prefs: Preferences;
  groupId: string | null;
}

const NAV_EVENT = 'guruai:navigate';

export function parseRoute(pathname: string, search = ''): Route {
  const session = /^\/s\/([0-9a-fA-F-]{8,64})\/?$/.exec(pathname);
  if (session) return { name: 'session', id: session[1] };
  if (/^\/new\/?$/.test(pathname)) return { name: 'new', groupId: new URLSearchParams(search).get('group') };
  if (/^\/settings\/?$/.test(pathname)) return { name: 'settings' };
  return { name: 'home' };
}

export function navigate(path: string, state: unknown = null, opts: { replace?: boolean } = {}): void {
  const here = window.location.pathname + window.location.search;
  if (path === here && !opts.replace && state === null) return;
  if (opts.replace) window.history.replaceState(state, '', path);
  else window.history.pushState(state, '', path);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo(0, 0);
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('popstate', cb);
  window.addEventListener(NAV_EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(NAV_EVENT, cb);
  };
}

const locationKey = () => window.location.pathname + window.location.search;

/** The current route; re-renders on navigate() and on Back/Forward. */
export function useRoute(): Route {
  const key = useSyncExternalStore(subscribe, locationKey);
  const [pathname, search = ''] = key.split(/(?=\?)/);
  return parseRoute(pathname, search);
}

/** The history.state of the current entry (e.g. a fresh session's choices). */
export function historyState<T>(): T | null {
  return (window.history.state as T | null) ?? null;
}
