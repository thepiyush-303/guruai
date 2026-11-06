// ============================================================
// session.test.ts — preference validation and the system prompt
// ============================================================

import { buildSystemPrompt, normalizePreferences } from '../session';
import { getLanguage, voskModelFor, LANGUAGES } from '../languages';

describe('normalizePreferences', () => {
  it('defaults to English with no input', () => {
    expect(normalizePreferences(undefined)).toEqual({ language: 'en', voice: 'Shivani' });
  });

  it('accepts valid language, grade and board', () => {
    expect(normalizePreferences({ language: 'ta', voice: 'Yashraj', grade: '9', board: 'CBSE' }))
      .toEqual({ language: 'ta', voice: 'Yashraj', grade: '9', board: 'CBSE' });
  });

  it('rejects unknown values', () => {
    const raw = { language: 'xx', voice: 'Nalini', grade: '99', board: 'IB' } as unknown as Parameters<typeof normalizePreferences>[0];
    // Nalini is a timbre-v2.5 voice — invalid with the default timbre-v3.0 model.
    expect(normalizePreferences(raw)).toEqual({ language: 'en', voice: 'Shivani', grade: undefined, board: undefined });
  });

  it('merges a partial update onto the current preferences', () => {
    const base = { language: 'hi' as const, voice: 'Kalpana', grade: '10', board: 'ICSE' as const };
    expect(normalizePreferences({ language: 'mr' }, base)).toEqual({ ...base, language: 'mr' });
  });
});

describe('buildSystemPrompt', () => {
  it('carries the language directive and class/board context', () => {
    const p = buildSystemPrompt({ language: 'hi', grade: '9', board: 'CBSE' });
    expect(p).toContain('GuruAI');
    expect(p).toContain('Hindi');
    expect(p).toContain('Devanagari');
    expect(p).toContain('Class 9');
    expect(p).toContain('CBSE');
  });

  it('tells the LLM which grammatical gender matches the voice', () => {
    expect(buildSystemPrompt({ language: 'hi', voice: 'Yashraj' })).toContain('masculine');
    expect(buildSystemPrompt({ language: 'hi', voice: 'Shivani' })).toContain('feminine');
  });
});

describe('languages', () => {
  it('falls back to English for unknown ids', () => {
    expect(getLanguage('klingon').id).toBe('en');
  });

  it('Hinglish uses ONE STT locale with codemix, and hi-en TTS', () => {
    // The live streaming API rejects locale lists (close 1008).
    expect(LANGUAGES.hinglish).toMatchObject({ sttLanguageCode: 'hi-IN', sttFormat: 'codemix', ttsLanguage: 'hi-en' });
  });

  it('every language has exactly one STT locale and a voice sample line', () => {
    for (const l of Object.values(LANGUAGES)) {
      expect(l.sttLanguageCode).toMatch(/^[a-z]{2}-IN$/);
      expect(l.sampleSentence).toContain('{voice}');
    }
  });

  it('Hinglish captions fall back to the Hindi Vosk model', () => {
    expect(voskModelFor(LANGUAGES.hinglish, { VOSK_MODEL_PATH_HI: 'models/hi' })).toBe('models/hi');
    expect(voskModelFor(LANGUAGES.ta, { VOSK_MODEL_PATH_HI: 'models/hi' })).toBeNull();
  });
});
