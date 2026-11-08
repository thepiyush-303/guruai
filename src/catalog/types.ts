// ============================================================
// catalog/types.ts — the built-in syllabus: track → program → subject →
// unit → topic. Each topic carries a short lesson outline (summary, the
// ordered chunks to teach, key terms) so a lesson can start teaching at
// once, without a planning call.
// ============================================================

import type { Board } from '../types';

export type TrackId = 'school' | 'college' | 'exam';

export interface Topic {
  /** Full path id: program.subject.unit.topic (e.g. "cbse-10.physics.electricity.ohms-law"). */
  id: string;
  title: string;
  summary: string;
  /** The lesson plan, simplest first (3–6 chunks). */
  chunks: string[];
  keyTerms: string[];
}

export interface Unit {
  id: string;
  title: string;
  topics: Topic[];
}

export interface Subject {
  id: string;
  title: string;
  /** An icon name the client knows (see client Icon.tsx). */
  icon: string;
  units: Unit[];
}

export interface Program {
  id: string;
  title: string;
  /** Short line under the title, e.g. "NCERT · CBSE". */
  note: string;
  /** What picking this program tells the teacher about the learner's level. */
  level: { grade?: string; board?: Board };
  subjects: Subject[];
}

export interface Track {
  id: TrackId;
  title: string;
  blurb: string;
  icon: string;
  programs: Program[];
}

/** A free-form chat area outside any syllabus. */
export interface OpenCategory {
  id: string;
  title: string;
  icon: string;
  blurb: string;
  /** Added to the teacher's system prompt for this kind of conversation. */
  promptHint: string;
  /** "Try asking" examples shown in the picker. */
  starters: string[];
}

/** Everything known about one topic, for the prompt and the client. */
export interface TopicContext {
  topic: Topic;
  unit: Unit;
  subject: Subject;
  program: Program;
  track: Track;
}
