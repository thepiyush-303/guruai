// ============================================================
// learnerProfile.ts — what GuruAI remembers about the student, across
// every session: name, class, interests (for analogies), how they like to
// learn, what they find hard.
//
// Rules (also given to the extractor):
//   - only facts the student said about themselves — never inferences;
//   - a fixed set of keys — anything else is dropped;
//   - never sensitive categories (religion, caste, health, money, contact
//     details) — dropped here even if the LLM proposes them;
//   - the student can see and delete everything (GET/DELETE /api/profile)
//     and switch memory off (memory_enabled).
// ============================================================

import { clearProfile, deleteProfileRow, getMeta, listProfileRows, setMeta, upsertProfileRow } from '../contextStore';

export const SCALAR_KEYS = ['name', 'class', 'board', 'school', 'city', 'exam_goal'] as const;
export const LIST_KEYS = ['interests', 'learning_preferences', 'strengths', 'difficulties', 'notes'] as const;
export type ProfileKey = (typeof SCALAR_KEYS)[number] | (typeof LIST_KEYS)[number];

const MAX_LIST_ITEMS = 8;
const MAX_VALUE_CHARS = 100;

/** Never stored, whatever the extractor proposes. */
const SENSITIVE =
  /\b(religio|caste|hindu|muslim|christian|sikh|jain|buddhis|dalit|illness|disease|disorder|disabilit|diagnos|depress|anxiety|income|salary|loan|debt|phone|mobile number|e-?mail|address|aadhaar|password)\w*|\d{6,}|@/i;

export type LearnerProfile = Partial<Record<(typeof SCALAR_KEYS)[number], string>> &
  Partial<Record<(typeof LIST_KEYS)[number], string[]>>;

export interface ProfileFact {
  key: string;
  value: unknown;
}

function isScalar(k: string): k is (typeof SCALAR_KEYS)[number] {
  return (SCALAR_KEYS as readonly string[]).includes(k);
}
function isList(k: string): k is (typeof LIST_KEYS)[number] {
  return (LIST_KEYS as readonly string[]).includes(k);
}

function cleanValue(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const t = String(v).replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE_CHARS);
  if (!t || SENSITIVE.test(t)) return null;
  return t;
}

export function memoryEnabled(): boolean {
  return getMeta('memory_enabled') !== 'false';
}

export function setMemoryEnabled(on: boolean): void {
  setMeta('memory_enabled', on ? 'true' : 'false');
}

export function loadProfile(): LearnerProfile {
  const profile: LearnerProfile = {};
  for (const row of listProfileRows()) {
    let v: unknown;
    try {
      v = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (isScalar(row.key) && typeof v === 'string') profile[row.key] = v;
    else if (isList(row.key) && Array.isArray(v)) profile[row.key] = v.filter((x): x is string => typeof x === 'string');
  }
  return profile;
}

/**
 * Merge proposed facts into the stored profile. Scalars replace; lists are
 * appended, de-duplicated and capped (most recent kept). Returns the keys
 * that changed. A no-op when memory is switched off.
 */
export function mergeProfileFacts(facts: unknown, sessionId: string | null): string[] {
  if (!memoryEnabled() || !Array.isArray(facts)) return [];
  const current = loadProfile();
  const changed = new Set<string>();

  for (const f of facts as ProfileFact[]) {
    if (!f || typeof f !== 'object' || typeof f.key !== 'string') continue;
    const key = f.key.trim().toLowerCase();
    if (isScalar(key)) {
      const v = cleanValue(Array.isArray(f.value) ? f.value[0] : f.value);
      if (v && current[key] !== v) {
        current[key] = v;
        changed.add(key);
      }
    } else if (isList(key)) {
      const incoming = (Array.isArray(f.value) ? f.value : [f.value]).map(cleanValue).filter((x): x is string => !!x);
      const list = [...(current[key] ?? [])];
      for (const v of incoming) {
        if (list.some((x) => x.toLowerCase() === v.toLowerCase())) continue;
        list.push(v);
        changed.add(key);
      }
      current[key] = list.slice(-MAX_LIST_ITEMS);
    }
    // anything else: not an allowed key — dropped
  }

  for (const key of changed) {
    upsertProfileRow(key, JSON.stringify(current[key as ProfileKey]), sessionId);
  }
  return [...changed];
}

/** Remove one fact, or (for list keys) one item of it. */
export function forgetProfileFact(key: string, item?: string): boolean {
  if (!isScalar(key) && !isList(key)) return false;
  if (item !== undefined && isList(key)) {
    const list = loadProfile()[key] ?? [];
    const next = list.filter((x) => x !== item);
    if (next.length === list.length) return false;
    if (next.length === 0) return deleteProfileRow(key);
    upsertProfileRow(key, JSON.stringify(next), null);
    return true;
  }
  return deleteProfileRow(key);
}

export function forgetEverything(): void {
  clearProfile();
}

const LABELS: Record<ProfileKey, string> = {
  name: 'Name',
  class: 'Class',
  board: 'Board',
  school: 'School',
  city: 'City',
  exam_goal: 'Preparing for',
  interests: 'Interests (use these for analogies)',
  learning_preferences: 'Learns best with',
  strengths: 'Strong at',
  difficulties: 'Finds hard',
  notes: 'Other',
};

/** Compact lines for the teacher prompt; empty when nothing is known. */
export function renderProfile(profile: LearnerProfile): string[] {
  const lines: string[] = [];
  for (const key of [...SCALAR_KEYS, ...LIST_KEYS]) {
    const v = profile[key];
    if (!v || (Array.isArray(v) && v.length === 0)) continue;
    lines.push(`${LABELS[key]}: ${Array.isArray(v) ? v.join('; ') : v}`);
  }
  return lines;
}
