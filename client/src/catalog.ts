// ============================================================
// catalog.ts — the built-in syllabus on the client: loading it, finding a
// topic's place in it, and searching it.
// ============================================================

import { useEffect, useState } from 'react';
import { fetchCatalog } from './api.ts';
import type { Catalog, CatalogProgram, CatalogSubject, CatalogTopic, CatalogTrack, CatalogUnit, OpenCategory, StudyChoice } from './protocol.ts';

export type CatalogState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; catalog: Catalog };

/** The catalog, fetched once and shared by every caller. */
export function useCatalog(): CatalogState {
  const [state, setState] = useState<CatalogState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    fetchCatalog()
      .then((catalog) => live && setState({ status: 'ready', catalog }))
      .catch((err: Error) => {
        if (!live) return;
        setState({ status: 'error', message: err.message });
        // One quiet retry: the server may still be starting.
        if (attempt === 0) window.setTimeout(() => live && setAttempt(1), 1500);
      });
    return () => {
      live = false;
    };
  }, [attempt]);
  return state;
}

/** Where a topic sits: its home track, program, subject and unit. */
export interface TopicPlace {
  topic: CatalogTopic;
  unit: CatalogUnit;
  subject: CatalogSubject;
  program: CatalogProgram;
  track: CatalogTrack;
}

const indexCache = new WeakMap<Catalog, Map<string, TopicPlace>>();

/** Every topic by id, at its home program (exam programs reuse home topics). */
function topicIndex(catalog: Catalog): Map<string, TopicPlace> {
  let index = indexCache.get(catalog);
  if (index) return index;
  index = new Map();
  for (const track of catalog.tracks) {
    if (track.id === 'exam') continue;
    for (const program of track.programs)
      for (const subject of program.subjects)
        for (const unit of subject.units) for (const topic of unit.topics) index.set(topic.id, { topic, unit, subject, program, track });
  }
  indexCache.set(catalog, index);
  return index;
}

export function findTopic(catalog: Catalog, id: string | null | undefined): TopicPlace | null {
  return id ? topicIndex(catalog).get(id) ?? null : null;
}

export function findCategory(catalog: Catalog, id: string | null | undefined): OpenCategory | null {
  return catalog.open_categories.find((c) => c.id === id) ?? null;
}

/** A short label for what a session studies: "Class 10 · Physics" + topic, or "Open chat" + area. */
export function studyLabel(catalog: Catalog | null, study: StudyChoice | undefined): { title: string; subtitle: string } | null {
  if (!catalog || !study) return null;
  if (study.kind === 'topic') {
    const place = findTopic(catalog, study.topicId);
    return place ? { title: place.topic.title, subtitle: `${place.program.title} · ${place.subject.title}` } : null;
  }
  const cat = findCategory(catalog, study.categoryId);
  return cat ? { title: cat.title, subtitle: 'Open chat' } : null;
}

// ── Search ────────────────────────────────────────────────────

export interface SearchHit {
  place: TopicPlace;
  score: number;
}

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '');

/**
 * Topics matching every word of the query. Title words weigh most, then key
 * terms, then the chunk names, then the unit and subject.
 */
export function searchTopics(catalog: Catalog, query: string, limit = 8): SearchHit[] {
  const words = fold(query).split(/[^a-z0-9]+/).filter((w) => w.length > 1 || /\d/.test(w));
  if (words.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const place of topicIndex(catalog).values()) {
    const fields: Array<[string, number]> = [
      [fold(place.topic.title), 6],
      [fold(place.topic.keyTerms.join(' ')), 3],
      [fold(place.topic.chunks.join(' ')), 2],
      [fold(`${place.unit.title} ${place.subject.title} ${place.topic.summary}`), 1],
    ];
    let score = 0;
    for (const w of words) {
      const best = Math.max(0, ...fields.map(([text, weight]) => (text.includes(w) ? weight : 0)));
      if (best === 0) {
        score = 0;
        break;
      }
      score += best;
    }
    if (score > 0) hits.push({ place, score: score + (fold(place.topic.title).startsWith(words[0]) ? 2 : 0) });
  }
  return hits.sort((a, b) => b.score - a.score || a.place.topic.title.localeCompare(b.place.topic.title)).slice(0, limit);
}

export function countTopics(subject: CatalogSubject): number {
  return subject.units.reduce((n, u) => n + u.topics.length, 0);
}
