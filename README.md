# GuruAI

**A voice study teacher for Indian students.** Students talk to GuruAI in their own language, and it
explains concepts the way a good teacher does: one small idea at a time, intuition first, with
analogies from everyday Indian life, and questions that check understanding. While it teaches, it
writes study notes beside the lesson that the student can download as a PDF.

Speech recognition and speech synthesis run on [Gnani.ai](https://gnani.ai): **Prisma** for
speech-to-text and **Timbre** for text-to-speech. Answers come from **Groq** or **Gemini**.

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Using GuruAI](#using-guruai)
- [Project structure](#project-structure)
- [HTTP API and WebSocket protocol](#http-api-and-websocket-protocol)
- [Data and privacy](#data-and-privacy)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Further documentation](#further-documentation)

---

## Features

**Talk — or type — in your language**
- Speak, or type a question in the box at the bottom of the session. Typed and spoken questions are treated the same.
- Spoken replies can be switched off (🔊 in the session, or Settings): replies then come as text only and nothing is sent to the speech service.
- 10 Indian languages plus Hinglish: English, हिन्दी, Hinglish, বাংলা, ગુજરાતી, ಕನ್ನಡ, മലയാളം, मराठी, ਪੰਜਾਬੀ, தமிழ், తెలుగు.
- 13 teacher voices (Timbre v3.0). Each one speaks every language, and you can hear a sample before choosing.
- Live captions of what you are saying, if a Vosk model is installed for the language.

**A teacher, not a chatbot**
- Topics are taught **one chunk at a time**:
  1. intuition first
  2. an analogy from daily life (cricket, local trains, a pressure cooker, monsoon…)
  3. the bridge back to the real concept and its proper term
  4. a check question, or an offer of a worked example
- It responds to your answers. A right answer gets specific praise, then the next chunk. A wrong answer gets a gentle correction and a *different* analogy. "Yes, example" gets a concrete worked example.
- Explanations are pitched to your **class and board** (Classes 6–12 or college; CBSE, ICSE or State board).
- **GuruAI speaks first.** A new session opens with a greeting and "what would you like to learn today?". A resumed session opens with a recap and an offer to continue where you left off.

**Memory**
- **Per session:** the topic, a running summary, the lesson plan (each chunk marked not yet taught, explained, understood or struggling), and what you found hard. It is reloaded whenever you reopen the session.
- **Across sessions:** a small learner profile built from what you say about yourself, such as your name, class, interests (used for analogies) and what you find hard. You can see, delete or switch off all of it.

**Sessions and navigation**
- A home page that explains GuruAI, a compact *New session* page, and a sidebar listing every session as a link: one click opens it, and the browser's Back/Forward work (`/`, `/new`, `/s/<id>`, `/settings`).
- Light, dark or system theme.
- Every conversation is saved, with a title generated from what was studied (e.g. "Photosynthesis in Plants").
- Organise sessions into your own **groups**, start a session inside a group, rename, move or delete.
- Resume any session and carry on talking: same language, same voice, same lesson.

**Live notes and PDF**
- Notes are written **beside the lesson while GuruAI teaches**: the subject as the headline, then definitions, key points, formulas (typeset with KaTeX), examples, tips and practice questions, in your language.
- Notes are on by default. Turn them off with a switch, or by saying "no notes" / "notes mat banao".
- **Download PDF:** an A4 document printed by Chrome, so Indic scripts render correctly.

---

## How it works

```
┌──────────────── Browser (React + Vite, client/) ────────────────┐
│ Silero VAD → 16 kHz PCM frames      captions · orb · notes panel │
└───────────┬──────────────────────────────────────▲──────────────┘
   WebSocket│ :8765 (audio + JSON events)          │ text events + TTS audio
            ▼                                      │
┌──────────────────────── Node server (src/) ──────────────────────┐
│ server.ts → messageHandler.ts → stateMachine.ts (pure) →          │
│ sideEffects.ts                                                    │
│                                                                   │
│  gnaniStt.ts   ──► Gnani Prisma (wss, streaming STT, REST retry)  │
│  gnaniTts.ts   ──► Gnani Timbre (wss, one sentence at a time)     │
│  voskProcess.ts──► vosk_server.py (live captions only)            │
│  groqStream.ts / geminiStream.ts ──► the LLM (streamed answer)    │
│                                                                   │
│  prompts/teacher.ts      teaching method + context, every turn    │
│  memory/*                session memory + learner profile         │
│  notes/*                 notes agent, notebook, PDF via Chrome    │
│  contextStore.ts         SQLite (data/vani.db)                    │
│  httpApi.ts              HTTP API on :3000 (also serves client)   │
└───────────────────────────────────────────────────────────────────┘
```

**One turn:**

1. The browser's VAD detects speech and streams 1024-byte PCM frames. The server forwards them live to Gnani Prisma, and to Vosk for live captions.
2. When the student stops, the server sends `commit`, and Prisma returns the transcript. If streaming fails or returns nothing for real speech, the audio is retried once over Prisma REST.
3. The system prompt is rebuilt from the database: the teaching method, the learner profile, this session's memory and lesson plan, and earlier sessions. Then the LLM streams **one chunk**.
4. The answer is split into sentences and sent to Gnani Timbre one at a time. Raw 22050 Hz audio streams back to the browser.
5. **After the answer, in the background** (never slowing the reply):
   - the memory updater refreshes the session memory and learner profile (one JSON LLM call)
   - the notes agent adds to the notes (one JSON LLM call, only while notes are on)
   - the titler names the session
   - the PDF is re-rendered a few seconds later

The browser keeps the microphone closed for the whole spoken answer, including the gaps between
sentences, so GuruAI never hears itself.

---

## Requirements

| What | Why | Notes |
|---|---|---|
| **Node.js 18+** (22 recommended) | server and client build | `fetch`/`FormData` are used built-in |
| **A Gnani API key** | speech in and out | from the Gnani platform (app.gnani.ai) |
| **A Groq or Gemini API key** | the teacher's answers and background jobs | Groq is the default `LLM_PROVIDER` |
| **Google Chrome** | notes PDF | optional; without it the notes still work, but without PDF (see [PDF](#notes-pdf)) |
| **Noto fonts** for Indic scripts | correct Hindi/Tamil/… in the PDF | `fonts-noto` on Debian/Ubuntu |
| **Python 3 + `vosk`** | live captions while you speak | optional; captions are simply off without it |
| **Internet access** | Gnani, the LLM, and the VAD model (loaded from jsDelivr) | |
| A microphone, ideally **headphones** | | headphones avoid echo; echo cancellation is on either way |

---

## Quick start

```bash
# 1. Install
npm install
cd client && npm install && cd ..

# 2. Configure
cp .env.example .env
#    then set at least GNANI_API_KEY and GROQ_API_KEY (or GEMINI_API_KEY + LLM_PROVIDER=gemini)

# 3. Check the Gnani key (optional, recommended)
npm run smoke:gnani -- tts "नमस्ते, आज हम प्रकाश संश्लेषण पढ़ेंगे।" hi
#    → writes data/smoke-tts.pcm; play: ffplay -f s16le -ar 22050 -ac 1 data/smoke-tts.pcm

# 4. Build the client, start the server
cd client && npm run build && cd ..
npm run dev
```

Open **http://localhost:3000**, choose a language, voice and class, and press **Start learning**.
Allow the microphone when the browser asks.

### Development mode

Run the server and the Vite dev server side by side. The client gets hot reload, and Vite proxies
`/api` to the server:

```bash
npm run dev                  # terminal 1 — WebSocket :8765, HTTP :3000
cd client && npm run dev     # terminal 2 — open the URL Vite prints (usually :5173)
```

### Production

```bash
cd client && npm run build && cd ..
npm run build && npm start   # compiled server; serves client/dist on HTTP_PORT
```

### Optional: live captions (Vosk)

Prisma returns only final transcripts. To see your words while you speak, install Vosk and a small
model for each language you use:

```bash
pip install -r requirements.txt          # just vosk
mkdir -p models && cd models
# download and unzip from https://alphacephei.com/vosk/models, e.g.
#   vosk-model-small-en-in-0.4    (Indian English)
#   vosk-model-small-hi-0.22      (Hindi; also used for Hinglish)
```

Then point the matching variables at the folders, for example `VOSK_MODEL_PATH_HI=models/vosk-model-small-hi-0.22`.
A language with no model shows "Listening…" until the final transcript arrives.

<a id="notes-pdf"></a>
### Notes PDF

PDFs are printed by the **installed Google Chrome** through `playwright-core`. Nothing is downloaded.
To use a different browser, set `PDF_BROWSER_CHANNEL` (e.g. `msedge`) or `PDF_BROWSER_PATH`
(any Chromium executable). On a machine without Chrome, run `npx playwright install chromium` and
set `PDF_BROWSER_PATH` to the browser it installs.

---

## Configuration

Everything lives in `.env`; `.env.example` documents each value. The ones that matter most:

**Server**

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8765` | WebSocket port. The client connects to `:8765`; if you change it, build the client with `VITE_WS_PORT=<port> npm run build` |
| `HTTP_PORT` | `3000` | HTTP: the built client and `/api` |

**Gnani speech**

| Variable | Default | Purpose |
|---|---|---|
| `GNANI_API_KEY` | — | **required**; stays on the server |
| `GNANI_STT_MODEL` | `prisma-v3.0` | speech-to-text model |
| `GNANI_TTS_MODEL` | `timbre-v3.0` | text-to-speech model (voices are model-specific) |
| `GNANI_TTS_VOICE` | `Shivani` | default voice; students choose their own |
| `GNANI_TTS_SPEED` | `1.0` | 0.85–1.15 |
| `GNANI_STT_VAD_THRESHOLD` | `0.5` | Gnani's speech-detection sensitivity (0.45–0.55 for clean mics) |
| `GNANI_STT_REST_URL` | Gnani REST | retry path for failed streaming utterances; empty disables it |
| `GNANI_TTS_REST_URL` | Gnani REST | voice samples, and the second chance for a sentence the TTS socket failed to speak |
| `VANI_VOCAB`, `VANI_VOCAB_FILE` | `vocab.txt` | subject terms to help recognition (ASCII) |

**LLM**

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `groq` | `groq` or `gemini` for answers |
| `GROQ_API_KEY`, `GROQ_MODEL` | — | Groq key and answer model |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | — / `gemini-2.5-flash-lite` | Gemini key and model |
| `SUMMARY_MODEL` | `GROQ_MODEL` | model for background jobs (memory, notes, titles) |

**Teaching, notes and storage**

| Variable | Default | Purpose |
|---|---|---|
| `OPENER_DELAY_MS` | `400` | pause before GuruAI greets a newly opened session |
| `NOTES_DIR` | `data/notes` | rendered PDFs |
| `PDF_DEBOUNCE_MS` | `5000` | re-render the PDF this long after notes change |
| `PDF_BROWSER_CHANNEL`, `PDF_BROWSER_PATH` | `chrome` | which browser prints PDFs |
| `VOSK_MODEL_PATH_<EN\|HI\|HINGLISH\|BN\|GU\|KN\|ML\|MR\|PA\|TA\|TE>` | — | live-caption models per language |
| `VANI_DB_PATH` | `data/vani.db` | SQLite database |
| `VOICE_PREVIEW_DIR` | `data/voice-previews` | cached voice samples |

> **Choosing the answer model.** The teaching method asks a lot of the model: one chunk, an analogy,
> one question, responding to the student. Small models follow it loosely. If answers run long or
> skip the analogy, use a stronger `GROQ_MODEL` (e.g. `openai/gpt-oss-120b`), and keep
> `SUMMARY_MODEL` small for the background jobs.

---

## Using GuruAI

1. **Home** (`/`) explains what GuruAI does. Click **Start a new session**, or **Continue** your last one.
2. **New session** (`/new`): pick a **language**, a **voice** (click one to hear it in that language; filter by Female/Male), optionally your **class**, **board** and a **group**, then **Start session**.
3. **The session** (`/s/<id>`) is the voice teacher, and the only screen with a microphone:
   - GuruAI greets you and asks what you want to learn. **Talk**, or **type** in the box at the bottom (Enter sends, Shift+Enter adds a line).
   - The mic button turns listening on/off. The mic is closed while GuruAI speaks and reopens when it finishes.
   - **■ Stop** silences the current answer; typing a new question also replaces it.
   - **🔊** switches spoken replies off/on (text only). The choice is remembered on this device.
   - Header: the session's title and language, the **voice** (change it between answers, ▶ to hear it), **Notes**, and **End** (back to Home; the session is saved).
4. **Side panel** (beside the lesson on wide screens, a slide-over on narrow ones):
   - **Notes:** written as GuruAI teaches. The switch pauses them for this session, *Download PDF* gives the file, and *Make notes in new sessions too* sets the default. Saying "no notes" / "make notes" works too.
   - **Lesson:** the lesson plan (topic, chunks with their status, "up next") and a summary so far.
   - **Log:** connection, speech and timing events (turn it on in Settings › Developer).
5. **Sidebar:** *New session*, search, **Groups** (the **+** makes one; a group's **⋯** has *New session here*, rename, delete) and **Recent** sessions (each row's **⋯**: rename, move to a group, delete). At the bottom: **Settings** and the theme switch. On a phone it opens from the ☰ button.
6. **Settings** (`/settings`): theme, spoken replies, notes for new sessions, **About you** (what GuruAI remembers, with delete buttons and a switch to stop remembering), and the developer log.

---

## Project structure

```
.
├── src/                          Node server (TypeScript)
│   ├── server.ts                 WebSocket + HTTP servers, wiring, shutdown
│   ├── messageHandler.ts         client messages + internal events → state machine
│   ├── stateMachine.ts           pure turn state machine (IDLE → LISTENING → … )
│   ├── sideEffects.ts            executes state-machine effects (STT, LLM, TTS)
│   ├── session.ts                sessions, preferences, prompt refresh
│   ├── sessionLifecycle.ts       open/resume a session, opener, initial pushes
│   ├── gnaniStt.ts               Prisma streaming client (pacing, commit, REST retry)
│   ├── gnaniTts.ts               Timbre streaming client (serial queue, accounting, REST second chance)
│   ├── gnaniTtsRest.ts           one-shot Timbre REST synthesis (samples, retries)
│   ├── ttsFraming.ts             TTS audio → binary WebSocket frames
│   ├── sentenceBuffer.ts         LLM tokens → speakable sentences
│   ├── groqStream.ts, geminiStream.ts   streamed answers
│   ├── llmText.ts                one-shot text/JSON LLM calls for background jobs
│   ├── prompts/teacher.ts        the teaching method + context blocks + opener
│   ├── memory/                   sessionMemory, learnerProfile, memoryUpdater
│   ├── notes/                    notebook (pure patcher), notesAgent, pdf
│   ├── titler.ts                 session titles from content
│   ├── languages.ts, voices.ts   language table, Timbre voice catalog
│   ├── voicePreview.ts           cached voice samples (Timbre REST)
│   ├── contextStore.ts           SQLite: turns, sessions, groups, memory, profile, notebooks
│   ├── httpApi.ts                /api routes
│   ├── voskProcess.ts            live-caption subprocess
│   ├── util/serialJobs.ts        one-at-a-time background jobs per session
│   ├── scripts/gnaniSmoke.ts     live API check
│   ├── scripts/ttsLongSmoke.ts   speak a long answer through the real Timbre socket, per-sentence report
│   └── __tests__/                Jest suites
├── client/                       React + Vite app
│   └── src/
│       ├── App.tsx               the shell: sidebar + current page
│       ├── router.ts             /, /new, /s/<id>, /settings (pushState, no dependency)
│       ├── library.ts            sessions, groups, voices (shared through context)
│       ├── settings.ts           per-device choices: theme, spoken replies, panels
│       ├── protocol.ts           wire types (mirrors src/types.ts)
│       ├── api.ts                HTTP API calls
│       ├── pages/                HomePage, NewSessionPage, SessionPage, SettingsPage
│       ├── hooks/                useVoiceSession (one session on one socket), useWsClient,
│       │                         useVadMic, useAudioPlayback, useOrbLevel, useMediaQuery
│       ├── components/           Sidebar, Thread, Composer, SidePanel, NotesPanel, VoicePicker,
│       │                         LessonProgress, ProfilePanel, Orb, Icon, Link
│       └── styles/               tokens (light/dark), base, shell, home, forms, session, panel
├── vosk_server.py                Vosk live-caption recognizer (stdin PCM → JSON)
├── vocab.txt                     recognition hints
├── data/                         runtime data (git-ignored): vani.db, notes/, voice-previews/
└── .claude/                      design doc, decisions (ADRs), tracker
```

---

## HTTP API and WebSocket protocol

### HTTP (`:3000`, `/api`)

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/sessions` | `{ groups, sessions }`, newest first |
| PATCH | `/api/sessions/:id` | `{ title?, group_id? }`: rename, move (`null` ungroups) |
| DELETE | `/api/sessions/:id` | delete a session, its transcript, memory and notes |
| POST / PATCH / DELETE | `/api/groups[/:id]` | create / rename / delete a group (its sessions are kept) |
| GET | `/api/voices` | voices for the configured Timbre model |
| GET | `/api/voice-preview?voice=&language=` | a spoken sample (`audio/wav`, cached) |
| GET / DELETE | `/api/profile[/:key][?item=]` | see / forget what GuruAI remembers |
| PATCH | `/api/settings` | `{ memory_enabled?, notes_default? }` |
| GET | `/api/notes/:id` | a session's notes as JSON |
| GET | `/api/notes/:id/pdf` | the notes as a PDF download |

Mutations require a JSON body or a non-simple method, so other websites cannot trigger them.

### WebSocket (`:8765`)

**Binary frames:**
- client → server: 16 kHz mono s16le PCM, 512-sample frames
- server → client: TTS audio, `[0xAF][0xFE][uint16 LE seq]` followed by 22050 Hz mono s16le PCM

| Direction | Message | Purpose |
|---|---|---|
| C→S | `session_init` | start: `session_id`, `preferences {language, voice, grade, board}`, `resume`, `group_id`, `voice_output` |
| C→S | `speech_start`, `speech_end`, `vad_misfire` | turn boundaries from the browser VAD |
| C→S | `switch_session` | new session (e.g. new language) or resume one, on the same connection |
| C→S | `update_preferences` | voice / class / board within a session |
| C→S | `set_notes` | notes on/off for this session |
| C→S | `text_input` | a typed question (between answers; replaces speech still playing) |
| C→S | `set_voice_output` | spoken replies on/off (off: text only, no TTS calls) |
| C→S | `stop_speaking` | silence the answer being spoken |
| S→C | `session_ack`, `preferences_ack`, `history_load` | session opened; effective settings; saved transcript |
| S→C | `state_change`, `transcript_partial`, `transcript_final`, `llm_token`, `turn_complete` | the turn as it happens |
| S→C | `tts_state` | GuruAI started or finished speaking (the client gates the mic); on finish, `spoken` / `failed` sentence counts |
| S→C | `tts_interrupted` | speech stopped (`barge_in`, `stopped`, `new_question`, `voice_off`): drop buffered audio |
| S→C | `session_context` | lesson progress (topic, chunks, next) |
| S→C | `notes_update` | the session's notes and PDF availability |
| S→C | `session_updated` | a generated title |
| S→C | `error` | with a code and a readable message |

Full message shapes are in `src/types.ts`, mirrored in `client/src/protocol.ts`.

One session is served at a time. A new connection (another session page, a reload) takes over and the
previous connection is closed with code `4000`.

---

## Data and privacy

- **What is stored:** everything is stored locally in `data/` (git-ignored):
  - `data/vani.db` (SQLite): transcripts as text, sessions and groups, session memory, the learner profile, notebooks, settings
  - `data/notes/`: rendered PDFs
  - `data/voice-previews/`: cached voice samples
- **Audio is never written to disk.** Speech is streamed to Gnani for recognition and held in memory only for the current utterance (for the REST retry).
- **What leaves the machine:** audio and text go to Gnani (speech) and to the configured LLM provider (answers and background jobs). API keys stay on the server.
- **The learner profile** keeps only facts the student said about themselves, from a fixed list (name, class, board, school, city, exam goal, interests, learning preferences, strengths, difficulties, notes). Religion, caste, health, money and contact details are refused, both in the instructions to the model and by a server-side filter. Students can view and delete everything in **About you**, or switch remembering off.
- **The server is single-user:** one active connection at a time, meant to run on the student's own machine.

---

## Testing

```bash
npm test                         # server: Jest (186 tests)
npx tsc --noEmit                 # server type-check
cd client && npm run build       # client type-check + build
cd client && npx eslint .        # client lint
```

**What the tests cover:**
- **Speech clients:** the Gnani STT and TTS clients run against local mock WebSocket servers, covering framing, pacing, commit handling, the REST retry, config errors, the serial TTS queue, cancellation, Timbre's double `complete`, and the REST second chance / split for sentences the socket fails to speak.
- **Core logic:** the state machine, sentence splitting, the teaching prompt, session memory, the learner profile and its filters, the memory updater (mocked LLM), sessions, groups, titles and the HTTP API.
- **Notes and PDF:** the notebook patcher and the notes agent. Real PDF renders through system Chrome are skipped automatically if there is no browser.

**Live checks with your keys:**

```bash
npm run smoke:gnani -- tts "<text>" <language>     # Timbre: writes data/smoke-tts.pcm
npm run smoke:gnani -- stt <file.wav|file.pcm> <language>   # Prisma: prints the transcript
npm run smoke:tts-long [-- <language> <voice>]     # a long answer through Timbre: every sentence, seconds of audio each
```

---

## Troubleshooting

| Symptom | What to check |
|---|---|
| `STT_FAIL` / "Speech recognition is not configured" | `GNANI_API_KEY` in `.env`; then `npm run smoke:gnani -- tts "hello" en` |
| `[gnani-stt] configuration rejected (1008)` | Gnani refused the connection settings (model, language, vocabulary). The log line includes Gnani's reason. Each streaming connection accepts exactly **one** language code. |
| "I didn't catch that" on soft speech | speak closer to the mic; lower `GNANI_STT_VAD_THRESHOLD` (e.g. `0.45`); use headphones |
| No live captions ("Listening…" only) | no Vosk model for that language; see [live captions](#optional-live-captions-vosk) |
| Long answers, headings read aloud, no analogies | use a stronger answer model (`GROQ_MODEL=openai/gpt-oss-120b`) |
| "Download PDF" disabled: *PDF needs Google Chrome…* | install Chrome, or set `PDF_BROWSER_PATH` / `PDF_BROWSER_CHANNEL` |
| Boxes instead of letters in the PDF | install the Noto fonts for that script (`fonts-noto`) |
| `could not open the mic` | allow microphone access; the page must be `localhost` or HTTPS |
| Voice sample doesn't play | the picker shows Gnani's error; usually the API key, or a voice from the wrong Timbre model |
| Session shows "Disconnected" | another tab or page opened a session (one at a time); click **Reconnect** |
| The end of a long answer is not spoken | the server log's `[gnani-tts] queue drained — spoken N/N` should show every sentence; `npm run smoke:tts-long` checks the voice service on its own |
| Notes don't appear | check the switch in the Notes panel; notes skip greetings and small talk; check the server log for `[notes]` |

The server log prefixes each subsystem (`[gnani-stt]`, `[gnani-tts]`, `[memory]`, `[notes]`, `[pdf]`,
`[titler]`, `[latency]`). The client side is in the session's **Log** tab (Settings › Developer).

---

## Further documentation

- [`.claude/guruai-design.md`](.claude/guruai-design.md): the full design. It covers architecture, the Gnani API as used, every phase in detail, risks and verification.
- [`.claude/decisions.md`](.claude/decisions.md): the decisions log (ADRs G1–G21): what was decided and why.
- [`.claude/todo.md`](.claude/todo.md): the phase tracker.
- [`PROJECT_DEEPDIVE_PRD.md`](PROJECT_DEEPDIVE_PRD.md): the original voice-pipeline specification (Vani, the project GuruAI grew from).
