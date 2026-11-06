// ============================================================
// voices.ts — the Gnani Timbre voice catalog (docs.gnani.ai
// "Available voices", checked 2026-11). Voices are model-specific:
// sending a v2.5 voice with timbre-v3.0 (or the reverse) is a 400.
// ============================================================

export interface VoiceInfo {
  id: string;
  gender: 'Female' | 'Male';
  persona: string;
  /** timbre-v2.5 only: the one language this voice is built for. */
  language?: string;
}

/** timbre-v3.0 — every voice speaks all 10 languages. */
const TIMBRE_V3: VoiceInfo[] = [
  { id: 'Shivani', gender: 'Female', persona: 'Warm, empathetic' },
  { id: 'Kalpana', gender: 'Female', persona: 'Warm, empathetic' },
  { id: 'Chetana', gender: 'Female', persona: 'Warm, empathetic' },
  { id: 'Tarika', gender: 'Female', persona: 'Warm, empathetic' },
  { id: 'Lakshmi', gender: 'Female', persona: 'Expressive, energetic' },
  { id: 'Vasudha', gender: 'Female', persona: 'Expressive, energetic' },
  { id: 'Riyaa', gender: 'Female', persona: 'Confident, authoritative' },
  { id: 'Yashraj', gender: 'Male', persona: 'Warm, empathetic' },
  { id: 'Devansh', gender: 'Male', persona: 'Conversational' },
  { id: 'Shubham', gender: 'Male', persona: 'Expressive, energetic' },
  { id: 'Avinash', gender: 'Male', persona: 'Professional' },
  { id: 'Harshad', gender: 'Male', persona: 'Professional' },
  { id: 'Prakash', gender: 'Male', persona: 'Professional' },
];

/** timbre-v2.5 — one preferred language per voice (subset most useful for teaching). */
const TIMBRE_V25: VoiceInfo[] = [
  { id: 'Nalini', gender: 'Female', persona: 'Friendly', language: 'Hindi' },
  { id: 'Chitra', gender: 'Female', persona: 'Warm, empathetic', language: 'Hindi' },
  { id: 'Vikrant', gender: 'Male', persona: 'Conversational', language: 'Hindi' },
  { id: 'Poorvi', gender: 'Female', persona: 'Conversational', language: 'Hinglish' },
  { id: 'Kaveri', gender: 'Female', persona: 'Professional', language: 'English' },
  { id: 'Pranav', gender: 'Male', persona: 'Friendly', language: 'English' },
  { id: 'Noopur', gender: 'Female', persona: 'Friendly', language: 'Tamil' },
  { id: 'Lavanya', gender: 'Female', persona: 'Warm, empathetic', language: 'Telugu' },
  { id: 'Saanvi', gender: 'Female', persona: 'Expressive, energetic', language: 'Kannada' },
  { id: 'Reshma', gender: 'Female', persona: 'Friendly', language: 'Malayalam' },
  { id: 'Ishaan', gender: 'Male', persona: 'Professional', language: 'Marathi' },
  { id: 'Kirra', gender: 'Female', persona: 'Conversational', language: 'Bengali' },
  { id: 'Falak', gender: 'Female', persona: 'Conversational', language: 'Gujarati' },
  { id: 'Mehuli', gender: 'Female', persona: 'Expressive, energetic', language: 'Punjabi' },
];

export function ttsModel(): string {
  return process.env.GNANI_TTS_MODEL ?? 'timbre-v3.0';
}

export function voicesForModel(model = ttsModel()): VoiceInfo[] {
  return /v2\.5/.test(model) ? TIMBRE_V25 : TIMBRE_V3;
}

/** The configured default voice, if it belongs to the model; else the catalog's first. */
export function defaultVoice(model = ttsModel()): string {
  const env = process.env.GNANI_TTS_VOICE?.trim();
  const voices = voicesForModel(model);
  return env && voices.some((v) => v.id === env) ? env : voices[0].id;
}

export function isVoice(id: unknown, model = ttsModel()): id is string {
  return typeof id === 'string' && voicesForModel(model).some((v) => v.id === id);
}
