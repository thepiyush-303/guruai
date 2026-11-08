// ============================================================
// catalog/index.ts — the built-in syllabus, assembled once at load.
//
// Topic ids become full paths (program.subject.unit.topic). Exam programs
// are resolved from references into the school/college programs, so their
// topics keep their home ids: a JEE lesson on kinematics is the same topic
// as the Class 11 one.
// ============================================================

import { MAX_CHUNKS } from '../memory/sessionMemory';
import { class9 } from './data/class9';
import { class10 } from './data/class10';
import { class11 } from './data/class11';
import { class12 } from './data/class12';
import { btechCse } from './data/college';
import { exams } from './data/exams';
import { OPEN_CATEGORIES } from './openCategories';
import type { OpenCategory, Program, Subject, TopicContext, Track, Unit } from './types';

export type { OpenCategory, Program, Subject, Topic, TopicContext, Track, Unit } from './types';

const MIN_CHUNKS = 3;
const MAX_TOPIC_CHUNKS = Math.min(6, MAX_CHUNKS);

/** Give every unit and topic of a program its full path id (fresh copies). */
function withIds(p: Program): Program {
  return {
    ...p,
    subjects: p.subjects.map((s) => ({
      ...s,
      units: s.units.map((u) => ({
        ...u,
        topics: u.topics.map((t) => ({ ...t, id: `${p.id}.${s.id}.${u.id}.${t.id}` })),
      })),
    })),
  };
}

const homePrograms = { school: [class9, class10, class11, class12].map(withIds), college: [btechCse].map(withIds) };
const byProgram = new Map<string, Program>([...homePrograms.school, ...homePrograms.college].map((p) => [p.id, p]));

const problems: string[] = [];

function resolveRef(ref: string): Unit[] {
  const [programId, subjectId, unitId] = ref.split('.');
  const program = byProgram.get(programId);
  const subject = program?.subjects.find((s) => s.id === subjectId);
  const units = subject ? (unitId ? subject.units.filter((u) => u.id === unitId) : subject.units) : [];
  if (!program || units.length === 0) {
    problems.push(`exam reference "${ref}" resolves to nothing`);
    return [];
  }
  // Unit ids repeat across classes ("calculus" in 11 and 12): prefix them.
  return units.map((u) => ({ ...u, id: `${programId}-${u.id}`, title: `${u.title} · ${program.title}` }));
}

const examPrograms: Program[] = exams.map((e) => ({
  id: e.id,
  title: e.title,
  note: e.note,
  level: { grade: e.grade },
  subjects: e.subjects.map((s): Subject => ({ id: s.id, title: s.title, icon: s.icon, units: s.refs.flatMap(resolveRef) })),
}));

export const TRACKS: Track[] = [
  {
    id: 'school',
    title: 'School',
    blurb: 'Class 9 to 12 · NCERT / CBSE — works for most State boards too',
    icon: 'school',
    programs: homePrograms.school,
  },
  {
    id: 'college',
    title: 'College & University',
    blurb: 'Degree subjects, unit by unit',
    icon: 'cap',
    programs: homePrograms.college,
  },
  {
    id: 'exam',
    title: 'Competitive exams',
    blurb: 'JEE, NEET and GATE syllabus',
    icon: 'target',
    programs: examPrograms,
  },
];

// ── Index and integrity checks ────────────────────────────────

const topicIndex = new Map<string, TopicContext>();
for (const track of TRACKS) {
  if (track.id === 'exam') continue; // exams reuse home topics
  for (const program of track.programs) {
    if (program.subjects.length === 0) problems.push(`program ${program.id} has no subjects`);
    for (const subject of program.subjects) {
      for (const unit of subject.units) {
        if (unit.topics.length === 0) problems.push(`unit ${program.id}.${subject.id}.${unit.id} has no topics`);
        for (const topic of unit.topics) {
          if (topicIndex.has(topic.id)) problems.push(`duplicate topic id ${topic.id}`);
          if (topic.chunks.length < MIN_CHUNKS || topic.chunks.length > MAX_TOPIC_CHUNKS) {
            problems.push(`topic ${topic.id} has ${topic.chunks.length} chunks (want ${MIN_CHUNKS}–${MAX_TOPIC_CHUNKS})`);
          }
          if (!topic.summary.trim()) problems.push(`topic ${topic.id} has no summary`);
          topicIndex.set(topic.id, { topic, unit, subject, program, track });
        }
      }
    }
  }
}
const categoryIds = new Set<string>();
for (const c of OPEN_CATEGORIES) {
  if (categoryIds.has(c.id)) problems.push(`duplicate open category ${c.id}`);
  categoryIds.add(c.id);
}
if (problems.length) console.warn(`[catalog] ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);

/** Integrity problems found while assembling the catalog (empty when sound). */
export function catalogProblems(): string[] {
  return [...problems];
}

export function topicCount(): number {
  return topicIndex.size;
}

/** A topic with its unit, subject, program and track — null for an unknown id. */
export function findTopic(id: unknown): TopicContext | null {
  return typeof id === 'string' ? topicIndex.get(id) ?? null : null;
}

export function findOpenCategory(id: unknown): OpenCategory | null {
  return OPEN_CATEGORIES.find((c) => c.id === id) ?? null;
}

/** What GET /api/catalog returns (prompt hints stay on the server). */
export function catalogPayload() {
  return {
    tracks: TRACKS,
    open_categories: OPEN_CATEGORIES.map(({ promptHint: _hint, ...c }) => c),
  };
}

/** A study choice resolved against the catalog, for the prompt and the opener. */
export type ResolvedStudy =
  | { kind: 'topic'; context: TopicContext }
  | { kind: 'open'; category: OpenCategory; ask?: string };

export function resolveStudy(choice: { kind: string; topicId?: string; categoryId?: string; ask?: string } | undefined | null): ResolvedStudy | null {
  if (!choice) return null;
  if (choice.kind === 'topic') {
    const context = findTopic(choice.topicId);
    return context ? { kind: 'topic', context } : null;
  }
  if (choice.kind === 'open') {
    const category = findOpenCategory(choice.categoryId);
    return category ? { kind: 'open', category, ask: choice.ask } : null;
  }
  return null;
}

/** "Physics · Reflection and spherical mirrors" / "Open chat · Software & coding". */
export function studyLabel(study: ResolvedStudy): { title: string; subtitle: string } {
  if (study.kind === 'topic') {
    const { topic, subject, program } = study.context;
    return { title: topic.title, subtitle: `${program.title} · ${subject.title}` };
  }
  return { title: study.category.title, subtitle: 'Open chat' };
}
