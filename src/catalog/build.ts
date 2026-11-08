// ============================================================
// catalog/build.ts — compact helpers for writing the syllabus data.
//
//   T(title, summary, 'chunk one | chunk two | chunk three', 'term, term')
//   U(title, ...topics)          a unit (usually one textbook chapter)
//   S(id, title, icon, ...units) a subject
//
// Ids are slugs of the titles; index.ts prefixes them into full paths.
// ============================================================

import type { Subject, Topic, Unit } from './types';

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const split = (s: string, sep: RegExp) => s.split(sep).map((x) => x.trim()).filter(Boolean);

export function T(title: string, summary: string, chunks: string, keyTerms = ''): Topic {
  return { id: slug(title), title, summary, chunks: split(chunks, /\s*\|\s*/), keyTerms: split(keyTerms, /\s*,\s*/) };
}

export function U(title: string, ...topics: Topic[]): Unit {
  return { id: slug(title), title, topics };
}

export function S(id: string, title: string, icon: string, ...units: Unit[]): Subject {
  return { id, title, icon, units };
}
