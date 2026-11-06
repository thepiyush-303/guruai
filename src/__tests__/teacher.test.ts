// ============================================================
// teacher.test.ts — the teaching-method prompt and the opener.
// ============================================================

import { buildTeacherPrompt, openerInstruction } from '../prompts/teacher';
import { emptyMemory, type SessionMemory } from '../memory/sessionMemory';

const lessonMemory: SessionMemory = {
  topic: 'Photosynthesis',
  gist: 'Started photosynthesis; the student understood that plants make food.',
  lesson: {
    goal: 'Understand how plants make food from light',
    chunks: [
      { title: 'Plants make their own food', status: 'understood' },
      { title: 'Chlorophyll captures light', status: 'explained' },
      { title: 'Water is split, oxygen released', status: 'pending' },
    ],
    next: 1,
  },
  student: { understood: ['plants make food'], struggling: [], misconceptions: ['plants eat soil'] },
  last_offer: 'example',
};

describe('buildTeacherPrompt', () => {
  it('always carries the method: intuition, analogy, bridge, one hand-back per chunk', () => {
    const p = buildTeacherPrompt({ prefs: { language: 'en' }, profile: {}, memory: emptyMemory(), recentSessions: [] });
    expect(p).toContain('Intuition first');
    expect(p).toContain('analogy');
    expect(p).toContain('ONE chunk per reply');
    expect(p).toContain('DIFFERENT analogy');
    expect(p).toContain('worked example');
  });

  it('adds no context blocks when nothing is known', () => {
    const p = buildTeacherPrompt({ prefs: { language: 'en' }, profile: {}, memory: emptyMemory(), recentSessions: [] });
    expect(p).not.toContain('ABOUT THE STUDENT');
    expect(p).not.toContain('THIS SESSION SO FAR');
    expect(p).not.toContain('EARLIER SESSIONS');
  });

  it('renders the lesson plan, marks the next chunk and the pending offer', () => {
    const p = buildTeacherPrompt({ prefs: { language: 'hi' }, profile: {}, memory: lessonMemory, recentSessions: [] });
    expect(p).toContain('Lesson on Photosynthesis');
    expect(p).toContain('1. Plants make their own food (understood)');
    expect(p).toContain('2. Chlorophyll captures light (explained, not yet checked) <- teach this next');
    expect(p).toContain('you offered an example');
    expect(p).toContain('Misconceptions to fix gently: plants eat soil');
  });

  it('uses the learner profile, with the picker overriding the profile class', () => {
    const p = buildTeacherPrompt({
      prefs: { language: 'en', grade: '10' },
      profile: { name: 'Riya', class: '8', interests: ['cricket'] },
      memory: emptyMemory(),
      recentSessions: ['Newton\'s Laws of Motion'],
    });
    expect(p).toContain('Name: Riya');
    expect(p).toContain('cricket');
    expect(p).toContain('Class 10 student');
    expect(p).not.toContain('Class 8 student');
    expect(p).toContain('- Newton\'s Laws of Motion');
  });

  it('says when the whole lesson is covered', () => {
    const done: SessionMemory = { ...lessonMemory, lesson: { ...lessonMemory.lesson!, next: 3 } };
    expect(buildTeacherPrompt({ prefs: { language: 'en' }, profile: {}, memory: done, recentSessions: [] })).toContain('All chunks are covered');
  });
});

describe('openerInstruction', () => {
  it('greets a new session and asks what to learn, by name when known', () => {
    const o = openerInstruction('new', { name: 'Riya' }, emptyMemory());
    expect(o).toContain('new study session');
    expect(o).toContain('Riya');
    expect(o).toContain('what they would like to learn');
  });

  it('welcomes back a resumed session and offers the next chunk', () => {
    const o = openerInstruction('resumed', {}, lessonMemory);
    expect(o).toContain('Welcome them back');
    expect(o).toContain('"Chlorophyll captures light"');
  });

  it('treats a resumed session without memory like a new one', () => {
    expect(openerInstruction('resumed', {}, emptyMemory())).toContain('new study session');
  });
});
