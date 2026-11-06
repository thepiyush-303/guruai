// ============================================================
// languages.ts — the single source of truth for the languages a
// student can learn in. One entry maps a student-facing choice to
// every engine-specific code: Gnani Prisma (STT), Gnani Timbre (TTS),
// the LLM's reply directive, and the Vosk live-caption model.
//
// Mirrored (id + labels only) in client/src/protocol.ts — if you add a
// language here, add it there too.
// ============================================================

export type LanguageId =
  | 'en' | 'hi' | 'hinglish' | 'bn' | 'gu' | 'kn' | 'ml' | 'mr' | 'pa' | 'ta' | 'te';

export interface LanguageConfig {
  id: LanguageId;
  /** English name, for logs and prompts. */
  label: string;
  /** Name in its own script, for the picker. */
  nativeLabel: string;
  /** Prisma `language_code` header — exactly ONE locale (the live streaming API rejects lists). */
  sttLanguageCode: string;
  /** Prisma `format` header. `codemix` is Prisma v3.0 only. */
  sttFormat: 'transcribe' | 'codemix' | 'verbatim';
  /** Timbre `language` field. */
  ttsLanguage: string;
  /** Appended to the system prompt: what language and script to answer in. */
  llmDirective: string;
  /** Env vars tried in order for this language's Vosk model directory. */
  voskModelEnvs: string[];
  /** Spoken while a tool runs ("one moment please"). */
  fillerPhrase: string;
  /** Voice-preview line; `{voice}` is replaced by the voice's name. */
  sampleSentence: string;
}

const TECH_TERMS = 'Keep standard technical and scientific terms in English inside brackets the first time you use them, the way Indian teachers do.';

function indic(
  id: LanguageId, label: string, nativeLabel: string, code: string, script: string, filler: string, sample: string,
): LanguageConfig {
  return {
    id,
    label,
    nativeLabel,
    sttLanguageCode: code,
    sttFormat: 'transcribe',
    ttsLanguage: code,
    llmDirective: `Always reply in ${label}, written in ${script} script. ${TECH_TERMS}`,
    voskModelEnvs: [`VOSK_MODEL_PATH_${id.toUpperCase()}`],
    fillerPhrase: filler,
    sampleSentence: sample,
  };
}

export const LANGUAGES: Record<LanguageId, LanguageConfig> = {
  en: {
    id: 'en',
    label: 'English',
    nativeLabel: 'English',
    sttLanguageCode: 'en-IN',
    sttFormat: 'transcribe',
    ttsLanguage: 'en-IN',
    llmDirective: 'Always reply in simple Indian English.',
    voskModelEnvs: ['VOSK_MODEL_PATH_EN', 'VOSK_MODEL_PATH'],
    fillerPhrase: 'One moment please.',
    sampleSentence: "Hello! My name is {voice}. What would you like to learn today?",
  },
  hi: indic('hi', 'Hindi', 'हिन्दी', 'hi-IN', 'Devanagari', 'एक क्षण रुकिए।',
    'नमस्ते! मेरा नाम {voice} है। आज आप क्या सीखना चाहेंगे?'),
  hinglish: {
    id: 'hinglish',
    label: 'Hinglish',
    nativeLabel: 'Hinglish',
    // One locale only on streaming; `codemix` keeps the English words in Latin
    // script, which is exactly how students speak Hinglish.
    sttLanguageCode: 'hi-IN',
    sttFormat: 'codemix',
    ttsLanguage: 'hi-en',
    llmDirective:
      'Always reply in Hinglish: conversational Hindi mixed with English, the way students talk. ' +
      'Write Hindi words in Devanagari script and English words in Latin script.',
    voskModelEnvs: ['VOSK_MODEL_PATH_HINGLISH', 'VOSK_MODEL_PATH_HI', 'VOSK_MODEL_PATH_EN'],
    fillerPhrase: 'एक moment रुकिए।',
    sampleSentence: 'Hi! मेरा नाम {voice} है। आज हम क्या सीखें?',
  },
  bn: indic('bn', 'Bengali', 'বাংলা', 'bn-IN', 'Bengali', 'এক মুহূর্ত অপেক্ষা করুন।',
    'নমস্কার! আমার নাম {voice}। আজ তুমি কী শিখতে চাও?'),
  gu: indic('gu', 'Gujarati', 'ગુજરાતી', 'gu-IN', 'Gujarati', 'એક ક્ષણ રાહ જુઓ.',
    'નમસ્તે! મારું નામ {voice} છે. આજે તમે શું શીખવા માંગો છો?'),
  kn: indic('kn', 'Kannada', 'ಕನ್ನಡ', 'kn-IN', 'Kannada', 'ಒಂದು ಕ್ಷಣ ಕಾಯಿರಿ.',
    'ನಮಸ್ಕಾರ! ನನ್ನ ಹೆಸರು {voice}. ಇಂದು ನೀವು ಏನು ಕಲಿಯಲು ಬಯಸುತ್ತೀರಿ?'),
  ml: indic('ml', 'Malayalam', 'മലയാളം', 'ml-IN', 'Malayalam', 'ഒരു നിമിഷം കാത്തിരിക്കൂ.',
    'നമസ്കാരം! എന്റെ പേര് {voice}. ഇന്ന് എന്താണ് പഠിക്കാൻ ആഗ്രഹിക്കുന്നത്?'),
  mr: indic('mr', 'Marathi', 'मराठी', 'mr-IN', 'Devanagari', 'एक क्षण थांबा.',
    'नमस्कार! माझं नाव {voice} आहे. आज तुम्हाला काय शिकायचं आहे?'),
  pa: indic('pa', 'Punjabi', 'ਪੰਜਾਬੀ', 'pa-IN', 'Gurmukhi', 'ਇੱਕ ਪਲ ਰੁਕੋ।',
    'ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਮੇਰਾ ਨਾਮ {voice} ਹੈ। ਅੱਜ ਤੁਸੀਂ ਕੀ ਸਿੱਖਣਾ ਚਾਹੋਗੇ?'),
  ta: indic('ta', 'Tamil', 'தமிழ்', 'ta-IN', 'Tamil', 'ஒரு நிமிடம் காத்திருங்கள்.',
    'வணக்கம்! என் பெயர் {voice}. இன்று நீங்கள் என்ன கற்க விரும்புகிறீர்கள்?'),
  te: indic('te', 'Telugu', 'తెలుగు', 'te-IN', 'Telugu', 'ఒక్క క్షణం ఆగండి.',
    'నమస్కారం! నా పేరు {voice}. ఈ రోజు మీరు ఏమి నేర్చుకోవాలనుకుంటున్నారు?'),
};

export const DEFAULT_LANGUAGE: LanguageId = 'en';

export function isLanguageId(v: unknown): v is LanguageId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGES, v);
}

export function getLanguage(id: unknown): LanguageConfig {
  return isLanguageId(id) ? LANGUAGES[id] : LANGUAGES[DEFAULT_LANGUAGE];
}

/** First configured Vosk model directory for this language, or null (no live captions). */
export function voskModelFor(lang: LanguageConfig, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const name of lang.voskModelEnvs) {
    const v = env[name]?.trim();
    if (v) return v;
  }
  return null;
}
