// ============================================================
// router.ts — four routes, real URLs, no dependency.
//
//   /            Home (what GuruAI is, continue or start)
//   /new         Start learning: pick a syllabus topic or an open-chat area
//                (?track=&program=&subject=&topic=  or  ?track=open&area=)
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
  | { name: 'new'; groupId: string | null; picker: PickerState }
  | { name: 'session'; id: string }
  | { name: 'settings' };

/** Carried in history.state when a session is started from /new. */
export interface FreshSessionState {
  fresh: true;
  prefs: Preferences;
  groupId: string | null;
}

/** Where the learner is in the /new picker — kept in the URL so Back goes up one level. */
export interface PickerState {
  track: string | null;
  program: string | null;
  subject: string | null;
  topic: string | null;
  area: string | null;
}

export function pickerHref(p: Partial<PickerState>, groupId: string | null = null): string {
  const q = new URLSearchParams();
  for (const key of ['track', 'program', 'subject', 'topic', 'area'] as const) {
    const v = p[key];
    if (v) q.set(key, v);
  }
  if (groupId) q.set('group', groupId);
  const qs = q.toString();
  return qs ? `/new?${qs}` : '/new';
}

const NAV_EVENT = 'guruai:navigate';

export function parseRoute(pathname: string, search = ''): Route {
  const session = /^\/s\/([0-9a-fA-F-]{8,64})\/?$/.exec(pathname);
  if (session) return { name: 'session', id: session[1] };
  if (/^\/new\/?$/.test(pathname)) {
    const q = new URLSearchParams(search);
    return {
      name: 'new',
      groupId: q.get('group'),
      picker: { track: q.get('track'), program: q.get('program'), subject: q.get('subject'), topic: q.get('topic'), area: q.get('area') },
    };
  }
  if (/^\/settings\/?$/.test(pathname)) return { name: 'settings' };
  return { name: 'home' };
}

export function navigate(path: string, state: unknown = null, opts: { replace?: boolean; keepScroll?: boolean } = {}): void {
  const here = window.location.pathname + window.location.search;
  if (path === here && !opts.replace && state === null) return;
  if (opts.replace) window.history.replaceState(state, '', path);
  else window.history.pushState(state, '', path);
  window.dispatchEvent(new Event(NAV_EVENT));
  if (!opts.keepScroll) window.scrollTo(0, 0);
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
