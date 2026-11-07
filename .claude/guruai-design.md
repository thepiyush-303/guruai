# GuruAI — Design Document

> Turning the Vani voice agent into **GuruAI**, a multilingual voice study teacher for Indian
> students, built on Gnani.ai's **Prisma** (speech-to-text) and **Timbre** (text-to-speech) models.
>
> Read with `decisions.md` (ADRs G1–G18 explain *why*) and `todo.md` (the live phase tracker).

**Last updated:** 2026-11-06 · **Status:** Phases 1–3 implemented

---

## 1. Goals

| # | Goal | What "done" looks like |
|---|---|---|
| 1 | **Speak the student's language** | The student picks one of 10 Indian languages or Hinglish. They talk in it and hear the answer in it, in a natural Indian voice. |
| 2 | **Teach, don't just answer** | Answers are structured explanations: intuition, an Indian everyday analogy, a worked example, a recap, and a check question. They adapt to class and board. |
| 3 | **Notes write themselves** | While the student learns, a sidebar fills with study notes titled by the subject. Topics, definitions, formulas and examples are added as questions are asked, in the student's language. |
| 4 | **Take the notes away** | The notes render to a PDF the student can download. The student can switch note-taking on or off, by button or by voice. |

**Non-goals for now:** multiple simultaneous users (the server is still single-session), barge-in
(Vani's barge-in work is paused), and a mobile app.

---

## 2. Phases

| Phase | Scope | Status |
|---|---|---|
| **1** | Replace Whisper and Piper with Gnani Prisma and Timbre. Add language selection and the class/board picker. Keep Vosk only for live captions. | **Implemented** |
| **2** | Teacher: chunked lessons, analogies, interaction, session memory, learner profile, opener. | **Implemented** (§6) |
| **3** | Live notes beside the lesson, notes on/off by switch or voice, PDF through system Chrome. | **Implemented** (§7) |

---

## 3. Architecture

### 3.1 Before (Vani)

```
Browser (React, Silero VAD) ── 16 kHz PCM ──► Node server ──► faster_whisper_server.py  (final STT, English)
                                               │          └─► vosk_server.py            (live captions)
                                               ├─► Gemini / Groq (LLM)
                                               └─► Piper subprocess (TTS, English, 22050 Hz) ──► browser
```

### 3.2 After Phase 1 (GuruAI)

```
┌──────────────────────── Browser — React + Vite (client/) ────────────────────────┐
│  <SessionSetup>  language · class · board   (before connecting)                   │
│  <Orb> <Captions> <Controls> <HistorySidebar> <LogSidebar>                        │
│  useVadMic (Silero, 512-sample / 1024-byte frames) · useAudioPlayback (22050 Hz)  │
└──────────────┬────────────────────────────────────────────────▲──────────────────┘
   session_init│{preferences} + PCM + speech_start/end          │ transcript_* · llm_token
               ▼                                                │ binary TTS [0xAF 0xFE seq]
┌──────────────────────────────── Node server (src/) ─────────────────────────────┐
│ server.ts → messageHandler.ts → stateMachine.ts (PURE) → sideEffects.ts          │
│ languages.ts   language table (STT code, TTS code, LLM directive, Vosk model)    │
│ gnaniStt.ts    Prisma realtime WS client  (frames streamed live, commit at end)  │
│ gnaniTts.ts    Timbre realtime WS client  (serial queue, raw s16le 22050 Hz)     │
│ ttsFraming.ts  4 KB re-chunking + [0xAF][0xFE][seq] header (moved from Piper)    │
│ voskProcess.ts live captions only, model chosen per language                     │
│ geminiStream.ts / groqStream.ts  LLM, now driven by the session system prompt    │
│ contextStore.ts / summarizer.ts  SQLite transcript + rolling summary (unchanged) │
└──────┬──────────────────────────────┬─────────────────────────────┬─────────────┘
       │ wss + 1024-byte PCM frames    │ wss + JSON {text,…}         │ stdin PCM
       ▼                               ▼                             ▼
 api.vachana.ai/stt/v3/stream    api.vachana.ai/api/v1/tts       vosk_server.py
 (Prisma v3.0)                   (Timbre v3.0)                   (display-only captions)
```

### 3.3 Turn lifecycle (Phase 1)

```
IDLE ──speech_start──► LISTENING            OPEN_STT_STREAM: new utterance on the Prisma socket, reset Vosk
  each PCM frame       ├─► gnaniStt.writeChunk  (streamed now, not buffered until the end)
                       └─► voskProcess.writeChunk → transcript_partial (live caption)
LISTENING ──speech_end──► TRANSCRIBING      COMMIT_STT: {"type":"commit"} → Prisma closes the segment
TRANSCRIBING ──stt_final──► LLM_STREAMING   START_LLM_STREAM with the language-aware system prompt
LLM_STREAMING ──llm_token──► TTS_STREAMING  START_TTS: sentence buffer → Timbre queue → binary frames
TTS_STREAMING ──llm_stream_complete──► IDLE SEND_TURN_COMPLETE (the Timbre queue keeps draining)
```

The state machine's transitions are **unchanged**. Only event and side-effect names changed
(see §5.5), so `stateMachine.ts` stays a pure, fully tested function.

---

## 4. Gnani API reference (as used)

From docs.gnani.ai, checked 2026-11-06. Verify model and voice names against the live API on the
first run. Authentication uses one API key in the header `X-API-Key-ID` (lowercase
`x-api-key-id` for the STT socket). The key lives only in the server's `.env` as `GNANI_API_KEY`
and never reaches the browser.

### 4.1 Prisma STT — realtime WebSocket

- **URL:** `wss://api.vachana.ai/stt/v3/stream`
- **Configuration is set through upgrade headers and fixed for the connection's lifetime.** Changing the language means reconnecting.

| Header | Our value | Notes |
|---|---|---|
| `x-api-key-id` | `GNANI_API_KEY` | required |
| `model` | `prisma-v3.0` (`GNANI_STT_MODEL`) | v2.5 is the default when omitted |
| `language_code` | per language, e.g. `hi-IN`; Hinglish `hi-IN` | **Exactly one locale on streaming.** The docs say v3.0 takes a list, but the live API closes with 1008: "exactly one locale is required" (seen 2026-11-06). REST does accept lists. |
| `format` | `transcribe`; Hinglish `codemix` | `codemix`/`transliterate` are v3.0 only |
| `x-sample-rate` | `16000` | must match the audio |
| `x-min-silence-ms` | `2000` (maximum) | server VAD set loose; client VAD decides turn ends |
| `x-vad-threshold` | `0.5` (`GNANI_STT_VAD_THRESHOLD`) | Gnani suggests 0.45–0.55 for clean mics; the default 0.7 missed soft first utterances |
| `x-idle-timeout-sec` | `300` | range 5–900 |
| `keyterms` / `bias_list` | from `vocab.txt` + `VANI_VOCAB` | v3.0 uses `keyterms`; v2.5 uses `bias_list` |

- **Audio:** raw PCM s16le mono, **exactly 1024 bytes per binary frame** (512 samples = 32 ms at 16 kHz), sent at real-time cadence. In the docs' words: "Do not buffer and burst; this degrades VAD accuracy."
- **Control:** `{"type":"commit"}` closes the open utterance immediately.
- **Server messages:**
  - `connected`
  - `speech_start` (voice detected)
  - `processing`
  - `transcript` (`text`, `segment_index`, `latency`, `detected_language_code`, `is_final: true`)
  - `error` (`message`; the session stays open)
- **No interim results.** Each closed segment yields exactly one `transcript`. That's why Vosk stays for live captions (ADR G4).
- **Limits:** a session lasts at most 15 minutes (close code 1001). A bad header gives close 1008. A bad key gives HTTP 401 before the socket opens.
- **Languages:** `bn-IN en-IN gu-IN hi-IN kn-IN ml-IN mr-IN pa-IN ta-IN te-IN`.

### 4.2 Timbre TTS — realtime WebSocket

- **URL:** `wss://api.vachana.ai/api/v1/tts` (header `X-API-Key-ID`).
- **Request** (JSON, **one request at a time per connection**; send the next one after `complete`):
  ```json
  { "text": "…", "voice": "Shivani", "model": "timbre-v3.0", "language": "hi-IN", "speed": 1.0,
    "audio_config": { "sample_rate": 22050, "num_channels": 1, "sample_width": 2,
                      "encoding": "pcm_s16le", "container": "raw" } }
  ```
- **Responses:**
  - `start` (`request_id`)
  - `audio` (`data.audio` base64, `data.chunk_index`, `data.is_final`)
  - `complete`
  - `error` (the connection stays open on recoverable errors)
- **Models:** `timbre-v3.0` has 13 voices that all speak all 10 languages: Avinash, Shivani, Lakshmi, Kalpana, Shubham, Prakash, Devansh, Yashraj, Chetana, Vasudha, Riyaa, Tarika, Harshad. `timbre-v2.5` has 42 language-specific voices.
- **Languages:** `auto hi-IN en-IN ta-IN te-IN kn-IN ml-IN mr-IN pa-IN bn-IN gu-IN hi-en` (Hinglish).
- **Speed:** 0.85–1.15. **Sample rates:** 8000/16000/22050/24000/44100/48000.
- **Text hygiene (from the docs):** write numbers, dates and currency as spoken words. The LLM prompt enforces this.

---

## 5. Phase 1 — detailed design (implemented)

### 5.1 Language table — `src/languages.ts`

This is the single source of truth. Each entry maps one student-facing choice to every
engine-specific code:

| id | Label | STT `language_code` / `format` | TTS `language` | Vosk model env |
|---|---|---|---|---|
| `en` | English (India) | `en-IN` / transcribe | `en-IN` | `VOSK_MODEL_PATH_EN` |
| `hi` | हिन्दी | `hi-IN` / transcribe | `hi-IN` | `VOSK_MODEL_PATH_HI` |
| `hinglish` | Hinglish | `hi-IN` / codemix | `hi-en` | `_HINGLISH` → `_HI` → `_EN` |
| `bn` | বাংলা | `bn-IN` | `bn-IN` | `VOSK_MODEL_PATH_BN` |
| `gu` | ગુજરાતી | `gu-IN` | `gu-IN` | `VOSK_MODEL_PATH_GU` |
| `kn` | ಕನ್ನಡ | `kn-IN` | `kn-IN` | `VOSK_MODEL_PATH_KN` |
| `ml` | മലയാളം | `ml-IN` | `ml-IN` | `VOSK_MODEL_PATH_ML` |
| `mr` | मराठी | `mr-IN` | `mr-IN` | `VOSK_MODEL_PATH_MR` |
| `pa` | ਪੰਜਾਬੀ | `pa-IN` | `pa-IN` | `VOSK_MODEL_PATH_PA` |
| `ta` | தமிழ் | `ta-IN` | `ta-IN` | `VOSK_MODEL_PATH_TA` |
| `te` | తెలుగు | `te-IN` | `te-IN` | `VOSK_MODEL_PATH_TE` |

Each entry also carries:
- an **LLM directive**, for example "Reply only in Hindi, in Devanagari script. Keep standard technical terms in English inside brackets."
- a localized **filler phrase**, used while a tool runs.

### 5.2 Prisma STT client — `src/gnaniStt.ts`

- **Connection lifecycle:**
  - The client connects eagerly when the session starts or the language changes, so the first utterance doesn't pay the TLS handshake.
  - When the socket closes (15-minute cap, idle timeout, or network drop), the client reconnects lazily on the next `beginUtterance()`.
  - Frames that arrive while the socket is still opening queue in memory (bounded to about 10 s of audio) and flush on open.
- **Framing:** a re-chunker guarantees exactly 1024-byte frames. The browser already sends 1024-byte frames, so this is a safety net. Before a commit, the remainder is zero-padded to a full frame.
- **Utterance aggregation.** This is the subtle part: Gnani's own VAD segments audio, and our client VAD also decides when the turn ends.
  - `segmentOpen` is true after Gnani sends `speech_start` and false after it sends `transcript`.
  - Every `transcript` that arrives during the utterance is collected.
  - On `commit()`:
    - If a segment is open, wait for its transcript. A transcript that arrives after the commit is the segment the commit closed, so the client emits `final = segments.join(' ')` **immediately**, with no extra wait.
    - If segments already arrived and none is open, wait a 250 ms settle window in case a `speech_start` is still in flight, then emit.
    - If no segment ever opened (Gnani heard no speech), wait 1.5 s for a late transcript, then emit an empty final. Empty finals take the existing path back to IDLE with "I didn't catch that".
    - A hard 6 s timeout emits `error` → `STT_FAIL` (recoverable).
- **`discard()`** (VAD misfire) drops everything for this utterance. A late transcript gets ignored.
- **No API key:** a loud startup warning, and every turn fails with a clear `STT_FAIL`.
- **Latency logging:** `[latency] STT` keeps its meaning (speech_end → final) and now also prints Gnani's server-side `latency` and `detected_language_code`.

### 5.3 Timbre TTS client — `src/gnaniTts.ts` + `src/ttsFraming.ts`

- **Persistent socket with a serial FIFO queue.** `synthesize(text)` enqueues. One request is in flight at a time, as the docs require. Gnani streams audio faster than real time, so sentence N+1 synthesizes while the browser plays sentence N. The pipeline stays full without parallel sockets.
- **Audio format:** we request `container: raw`, `encoding: pcm_s16le`, `sample_rate: 22050`. This is byte-identical to Piper's output, so `useAudioPlayback` and the `[0xAF][0xFE][uint16 LE seq]` frame header don't change.
- **Byte hygiene:**
  - Base64 is decoded per `audio` message.
  - A `RIFF…data` header is stripped if the server sends WAV anyway.
  - An odd trailing byte is carried to the next chunk, so every frame payload is even-length. The client's `Int16Array` view throws on odd lengths.
- **`kill()`** (error or a future barge-in):
  1. Clears the queue.
  2. Marks the in-flight request cancelled.
  3. Closes the socket so Gnani stops generating.
  4. Resets the frame sequence.
  The next `synthesize()` reconnects.
- **Errors:** a Gnani `error` for one sentence is logged and skipped, and the queue moves on. A dropped socket retries the in-flight sentence once.
- **`ttsFraming.ts`** holds the 4 KB re-chunking, idle tail flush and header builder, moved verbatim from the old `piperProcess.ts`.

### 5.4 Sentence buffer, retuned for network TTS — `src/sentenceBuffer.ts`

A Piper fragment cost almost nothing. A Timbre request costs a network round trip, and tiny
fragments sound choppy. So:
- Hard boundaries are `. ? !`, the Indic danda `।` and `॥`, and newlines.
- Soft boundaries (`, ; :`) count only once the buffer holds 80 characters or more.
- Fragments shorter than 24 characters wait to merge with the next one.
- Timeout flushes: 250 ms for the first fragment of a turn (time-to-first-audio), 600 ms after that.
- A hard cap of 220 characters splits at the last space.
- `sanitizeForTTS` also strips markdown symbols (`* _ # \``) and emoji. Teachers like bold text; the voice must not read asterisks aloud.

### 5.5 State machine, side effects and messages (renames only)

| Old | New |
|---|---|
| `whisper_final` / `whisper_error` / `whisper_partial` | `stt_final` / `stt_error` / *(removed)* |
| `OPEN_WHISPER_PIPE` | `OPEN_STT_STREAM` |
| `SEND_EOF_TO_WHISPER` | `COMMIT_STT` |
| `DISCARD_WHISPER_BUFFER` | `DISCARD_STT` |
| `SPAWN_PIPER` / `KILL_PIPER` | `START_TTS` / `STOP_TTS` |
| `SessionContext.audioBuffer` | removed (frames stream live) |
| `wake_word_detected` | removed (Porcupine was dropped in Vani D4) |

`SessionContext` gains `preferences: { language, grade?, board? }`.

### 5.6 Live captions with Vosk (kept, per-language)

Prisma has no interim results, so Vosk keeps providing the words-as-you-speak caption.
- It is display-only, exactly as before; Prisma's final is what the LLM sees.
- The model is chosen per language from `VOSK_MODEL_PATH_<ID>`. `voskProcess.setModel()` restarts the Python process with the new model.
- With no model configured for a language, live captions are off. `preferences_ack.live_captions = false` makes the UI show a "listening…" pulse until the Prisma final lands.

Suggested small models (from alphacephei.com/vosk/models):
- `vosk-model-small-en-in-0.4` (Indian English)
- `vosk-model-small-hi-0.22`
- `vosk-model-small-te-0.42`
- `vosk-model-small-gu-0.42`

Coverage for other languages varies.

### 5.7 LLM plumbing

- `session.ts` builds the system prompt from the preferences: the GuruAI identity, the language directive, the spoken-output rules (no markdown, numbers and formulas as words), and class/board context.
- **Gemini bug fixed:** `geminiStream.ts` previously ignored the session's system message, used a hardcoded prompt, and sent the system message as a *user* turn. It now sets `systemInstruction` from the session prompt and drops `system` messages from `contents`.
- `groqStream.ts` likewise uses the session prompt.
- The weather and Todoist tools are no longer registered (the modules stay in `src/tools/`). Google Search grounding stays on Gemini so facts stay current.

### 5.8 Wire protocol

| Dir | Message | Shape |
|---|---|---|
| C→S | `session_init` | `+ preferences: { language: LanguageId, grade?: string, board?: 'CBSE'\|'ICSE'\|'STATE'\|'OTHER' }` (defaults to `en`) |
| C→S | `update_preferences` | `{ type, session_id, preferences }`. Accepted only in IDLE, otherwise `INVALID_STATE`. |
| S→C | `preferences_ack` | `{ type, session_id, preferences, live_captions: boolean, tts_voice: string }` |
| S→C | `transcript_final` | `+ detected_language?: string` |
| S→C | binary TTS | unchanged: `[0xAF][0xFE][uint16 LE seq]` + s16le 22050 Hz mono |

### 5.9 Client

- **`SessionSetup`**, shown while disconnected:
  - A language grid labeled in native script.
  - A class picker (6–12, College) and a board picker (CBSE / ICSE / State / Other).
  - The choice is saved to `localStorage`. "Start learning" connects and sends the preferences in `session_init`.
- **Language chip** in the header rail while connected. Changing it while idle sends `update_preferences`.
- **Fonts:** Noto Sans for Devanagari, Bengali, Gujarati, Gurmukhi, Kannada, Malayalam, Tamil and Telugu, loaded from Google Fonts and added to every text font stack.
- **VAD:** `redemptionFrames` goes from 4 to 12 (about 128 ms to about 384 ms) so a student can pause mid-thought without ending the turn.

### 5.10 Configuration (`.env`)

```
GNANI_API_KEY=…                 # required
GNANI_STT_MODEL=prisma-v3.0
GNANI_TTS_MODEL=timbre-v3.0
GNANI_TTS_VOICE=Shivani
GNANI_TTS_SPEED=1.0
GNANI_STT_URL=wss://api.vachana.ai/stt/v3/stream
GNANI_TTS_URL=wss://api.vachana.ai/api/v1/tts
VOSK_MODEL_PATH_EN=models/vosk-model-small-en-in-0.4
VOSK_MODEL_PATH_HI=models/vosk-model-small-hi-0.22
LLM_PROVIDER=gemini
GEMINI_API_KEY=…
```

Removed: `WHISPER_*` and `PIPER_*`. Python dependencies are now just `vosk`.

### 5.11 Bugs fixed along the way

- **First LLM token never spoken.** The first token arrived in `LLM_STREAMING` and was appended to the sentence buffer *before* the transition whose `START_TTS` effect creates that buffer, so it was dropped. With Piper this lost one word; with sentence-sized Timbre requests it lost the opening phrase. The transition now runs first (`messageHandler.ts`, `llm_token`).
- **Words glued together in Gemini replies.** `sanitizeForTTS` trimmed every streamed chunk, deleting the space between chunks ("first law" + " states" became "lawstates"). Streamed chunks now go through `sanitizeTtsChunk`, which does not trim. Whole sentences are still trimmed before TTS.
- **Gemini ignored the session prompt** and sent it as a user turn (§5.7).
- **Groq got two system prompts** (its hardcoded one plus the session's). It now gets only the session's.

### 5.12 Fixes after the first live run (2026-11-06)

The first run against the real API surfaced these problems.

| Symptom | Cause | Fix |
|---|---|---|
| Hinglish: every turn `STT_FAIL` / `STT_DISCONNECTED`, and the log fills with reconnects | Streaming rejects `language_code: hi-IN,en-IN` (close 1008), and the client reconnected with the same headers on every frame | Hinglish uses `hi-IN` + `codemix`. A 1008 rejection is now treated as a configuration error: no reconnect until the language changes, and the server's message reaches the student. |
| The first utterance after connecting comes back empty | The user spoke before Gnani's handshake finished, and the queued audio was then sent in one burst. Bursting degrades Gnani's VAD. | An outbound **pacer** sends a backlog at one frame per 16 ms (`GNANI_STT_PACE_MS`). In steady state, frames still go out as they arrive. |
| Soft speech missed | The default `x-vad-threshold` is 0.7 | 0.5, per Gnani's guidance for clean mics |
| A failed or empty streaming utterance is simply lost | No second path | **REST retry**: the utterance's audio (kept in memory, at most 30 s) is wrapped as WAV and sent once to `POST /stt/v3` when streaming errors, times out, disconnects, is rejected, or returns empty for at least 0.4 s of speech. The latency log marks it `via REST retry`. |
| One reply became 26 choppy TTS requests | The comma split checked the *buffer* length, and a fast LLM fills the buffer at once | A comma splits only if the fragment before it is at least 120 characters |
| Spoken "Core idea…", "Step 1…" headings | The model (gpt-oss) formats answers like a document | The prompt now forbids headings and section labels and asks for flowing speech |

### 5.13 Voices

- **Catalog:** `src/voices.ts` holds Gnani's Timbre catalog, with gender and persona from docs.gnani.ai. There are 13 v3.0 voices, all speaking every language, and a teaching-friendly subset of the v2.5 voices (one language each). Voices are model-specific; a voice from the wrong model gets a 400, so preferences validate against the configured model.
- **Picker:** a picker on the start screen plays a short sample when a voice is clicked. The sample is spoken by that voice in the selected language ("Hello! My name is Shivani. What would you like to learn today?"; the lines are written gender-neutral). It comes from `GET /api/voice-preview?voice=&language=`, which calls Timbre REST and caches the WAV in memory and in `data/voice-previews/` (`VOICE_PREVIEW_DIR`). Only valid WAVs are cached.
- **Storage and switching:** the voice is a session preference (`preferences.voice`), saved with the session. It can be changed between answers from the header without starting a new session (`update_preferences`).
- **Gendered grammar:** the system prompt tells the LLM which grammatical gender to use for itself, because Hindi, Marathi and others conjugate by speaker ("समझाती" vs "समझाता").

### 5.14 Sessions

- **What a session is:** one conversation in one language, with its own voice, class, board, transcript and rolling summary. The `sessions` table holds id, title, language, voice, grade, board, summary, `summary_upto` and timestamps. `turns.session_id` points to it.
- **Lifecycle:**
  - **New:** choosing a language and pressing Start, switching language from the header, or "New session" in the Sessions panel each start a new session.
  - **Saved:** the row is created on the session's first user turn, so sessions nobody spoke in are never listed. Its title is generated from the content (§5.17).
  - **Resume:** clicking a saved session, on the start screen or in the Sessions panel, resumes it. Its own language, voice and class are restored (the session is bound to its language). The LLM context is rebuilt from **that session's** summary and last 12 turns, and its transcript fills the sidebar and the stage scroll-back, so the student carries on where they stopped.
- **Grouping:** *(superseded by §5.17: individual sessions in groups the student makes)*
- **Isolation:** before this change, every connection loaded the last turns and one global summary *across all sessions*, which mixed languages and topics. Context is now strictly per session, and the summarizer folds turns per session (`runSummarizerBackground(sessionId)`).
- **Switching:** happens in-band over the same WebSocket (`switch_session`), only while idle. This avoids a reconnect racing the server's single-connection guard.
- **Migration:** on startup, existing turns are backfilled into session rows (one per old connection, language `en`, titled by the first question).

| Dir | Message / route | Shape |
|---|---|---|
| C→S | `session_init` | `+ resume: boolean`. With `resume`, `session_id` names the saved session to continue. |
| C→S | `switch_session` | `{ session_id, preferences, resume }`, IDLE only. Same semantics, without reconnecting. |
| C→S | `update_preferences` | voice, class and board only. The language is fixed per session. |
| S→C | `session_ack` | `+ resumed: boolean, title: string \| null` |
| S→C | `history_load` | now **this session's** turns. Always sent, empty for a new session. |
| HTTP | `GET /api/sessions` | saved sessions with `turn_count` and `last_text`, newest first |
| HTTP | `GET /api/voices` | `{ model, default_voice, voices: [{id, gender, persona, language?}] }` |
| HTTP | `GET /api/voice-preview` | `audio/wav` sample |

In development, Vite proxies `/api` to the agent server (`client/vite.config.ts`). In production it is same-origin.

### 5.16 Second live run: freeze, self-hearing, cut-off answers (2026-11-06)

| Symptom | Cause | Fix |
|---|---|---|
| After a long answer the whole page seems frozen; nothing is clickable | **Layout, not a hang.** The middle grid row was `1fr` and the stage centred its columns, so a long answer made the transcript column taller than the screen. It spilled over the header and the controls. Its fade `mask-image` gives it its own stacking layer, painted above them, so it swallowed every click. | `.app` rows are `auto minmax(0, 1fr) auto`. The stage stretches its columns to its own height and clips. The orb stays centred. The header and footer get `z-index: 3`. |
| Long answers can't be scrolled | Same cause: the column was never shorter than its content, so its scroller never scrolled. Also, every growth event (each revealed word) snapped it back to the bottom. | Fixed by the layout change. It now follows the bottom only while you are already at the bottom; scroll up to re-read and it stays put. |
| Repeated `STT_EMPTY` after a long answer (the REST retry also empty) | **GuruAI was hearing itself.** The mic re-opened 300 ms after the last scheduled audio, but Timbre takes about 350–550 ms to start the next sentence. In every gap between sentences the mic was live, and the VAD triggered on residual playback. The next sentence then closed the gate mid-utterance and swallowed the `speech_end`. The audio sent was echo-cancelled near-silence, so both STT paths correctly found no words. | The server sends `tts_state {active}`: true from the first queued sentence until the queue drains or is cancelled. The client keeps the mic closed while it is true, *including the gaps between sentences*. If the gate closes mid-utterance anyway, the client sends `vad_misfire`, so the server never waits in LISTENING. |
| The last lines of long answers are not spoken | Each Timbre request had a 15 s **total** limit. Timbre streams long sentences at about speaking pace, so a long sentence could hit the limit and be cut off. | The limit is now **inactivity**: 12 s with no message from Gnani. The queue logs `queue drained — N sentence(s) spoken`. |

### 5.17 Sessions, revised: individual sessions, groups you make, generated titles

This supersedes the "grouped by language" part of §5.14 (at the user's request).

- **Individual sessions:** sessions are listed one by one, newest first, each showing its language as a tag. Languages no longer form the grouping; one session is still one language.
- **Groups:** the student creates groups (for example "Physics" or "Board exam revision") and can:
  - start a session inside a group: "+ Session" in the group, or "Save in group" on the start screen
  - move a session between groups, or out of them
  - rename or delete a group; deleting a group keeps its sessions
  - rename or delete a session; the session that is currently open can't be deleted
  Storage: `session_groups(id, name, …)` and `sessions.group_id`.
- **Titles:**
  - **Generated from content, not the first question.** `src/titler.ts` asks the LLM for a 3–5 word chapter-style heading in the session's language, ignoring greetings and small talk. For example, "can you hear me? explain photosynthesis" becomes "Photosynthesis in Plants".
  - **When it runs:** after the first answer, refined at 6 and 12 turns, and pushed live to the client as `session_updated`.
  - **Your own names win:** a title the student types (`title_source = 'user'`) is never overwritten.
  - **Older sessions:** sessions saved before this change, which were named after their first question, are renamed in the background shortly after the server starts.
- **API:**

| Method | Route | Body / effect |
|---|---|---|
| GET | `/api/sessions` | `{ groups, sessions }` |
| PATCH | `/api/sessions/:id` | `{ title? , group_id? }`; `group_id: null` ungroups |
| DELETE | `/api/sessions/:id` | deletes the session and its transcript (409 for the open session) |
| POST | `/api/groups` | `{ name }` → `201 { group, groups, sessions }` |
| PATCH | `/api/groups/:id` | `{ name }` |
| DELETE | `/api/groups/:id` | deletes the group; its sessions become ungrouped |

  Mutations need a JSON body or a non-simple method, so another website cannot trigger them without a CORS preflight, which this server never grants.

- **Protocol:**
  - `session_init` and `switch_session` add `group_id` (applied when a new session is first saved).
  - `session_ack` adds `group_id`.
  - New S→C `session_updated {session_id, title}` and `tts_state {active}`.
- **Background LLM:** `src/llmText.ts` is one helper for background calls (titles, summaries). It uses Groq if `GROQ_API_KEY` is set, otherwise Gemini, with low reasoning effort for reasoning models.

### 5.18 Verified so far

- `npx tsc --noEmit` is clean. `npm test` passes 116 tests across 8 suites. The client's `npm run build` and `eslint` are clean.
- **Live API (by the user, 2026-11-06):** English turns worked end to end (STT 218–678 ms wall, Gnani 76–124 ms; TTS first audio 356–538 ms). The Hinglish failures that run exposed are fixed in §5.12.
- **Mock end-to-end for sessions:**
  - new Hindi session with Yashraj → turn → new Tamil session (empty, not listed) → new Hinglish session (`hi-IN`/`codemix`) → turn → resume Hindi (`resumed=true`, title, language, voice, class and its 2 turns restored, client `en` ignored)
  - `/api/sessions` lists two sessions; `/api/voices` returns 13 voices
  - voice preview is synthesized once, then cached; a v2.5 voice gets a 400
- **Migration:** run against a copy of the real `data/vani.db`, it produced 4 sessions titled by their first questions.
- **Second mock end-to-end:**
  - The TTS mock streams each sentence at speaking pace (1.8 s each). `tts_state active` stayed true for the whole 13.7 s answer, with no gaps, and all 7 sentences were delivered.
  - Title "Photosynthesis in Plants" was generated from "can you hear me? explain photosynthesis" and pushed live.
  - The session was saved in a group created through the API.
- 127 server tests pass, including the new TTS inactivity-timeout and activity tests and the groups, titles and API tests.
- **End-to-end turn against mock servers:**
  - Setup: the real server, mock Gnani STT and TTS sockets, and a mock streaming LLM through `GROQ_BASE_URL`.
  - Sequence: `session_init {hi, 9, CBSE}` → `preferences_ack` → speech → Prisma headers `hi-IN`/`transcribe` → `transcript_final` in Devanagari → LLM gets the GuruAI system prompt → three Timbre requests in order, with markdown stripped and the first phrase included → framed, even-length binary audio to the client → `turn_complete`.
  - Language switch: changing to Tamil while idle reconnected STT with `ta-IN`.
- **Not yet verified:** the live Gnani API (needs `GNANI_API_KEY`), and the UI in a real browser with a microphone.

---

## 6. Phase 2 — The teacher: chunked lessons, analogies, interaction, memory (implemented)

### 6.1 Overview

Each answer is still streamed straight to speech. Planning and memory happen **in the background, between turns**, so the teaching method adds no latency:

```
student speaks ─► Prisma ─► refreshContext(ctx): system prompt rebuilt from the DB
                             (teacher method + learner profile + session memory + earlier sessions)
                          ─► LLM streams ONE chunk ─► Timbre ─► student
                                      │ answer stored
                                      ▼ background (memoryUpdater.ts), one JSON LLM call
                     session memory: topic, gist, lesson plan (chunks + status), student state, last offer
                     learner profile: facts the student said about themselves
```

The student normally takes several seconds to reply, so the update is done before the next question. If it isn't, that answer uses the previous memory. The update never blocks.

### 6.2 The teaching method — `src/prompts/teacher.ts`

`buildTeacherPrompt({ prefs, profile, memory, recentSessions })` is a pure function, rebuilt before **every** answer by `refreshContext` in `src/session.ts`, which is called from `triggerLLMStream`.

**One chunk per reply**, about 60–110 spoken words (up to about 170 for a worked example):
1. **Intuition first:** what the idea is and why it matters, in plain words.
2. **An analogy from the student's daily life** in India (cricket, local trains, a pressure cooker, chai, monsoon, a kirana shop…). It uses the profile's interests when known.
3. **Bridge back** to the real concept, naming the proper term.
4. **Hand the turn back** with exactly one of: a check question, or an offer ("Shall I give you a real example, or shall we move to the next part?").

**Responding to the student:**
- **Correct answer:** specific praise, then the next chunk.
- **Wrong or partial answer:** gentle correction, then a *different* analogy and a smaller step.
- **Accepts an example:** a concrete worked example.
- **"I don't understand":** an even smaller step with a new analogy. **"Skip":** move on.
- **Side question:** answer it briefly, then offer to return to the lesson.
- **New broad topic:** start right away with the most basic chunk.

**Context blocks**, added only when they hold something:
- **ABOUT THE STUDENT** (the profile)
- **THIS SESSION SO FAR:** the gist, then the lesson with every chunk's status and "← teach this next", and what the last reply offered
- **STUDENT'S UNDERSTANDING:** understood, struggling, misconceptions
- **EARLIER SESSIONS:** titles, so the teacher can link back

Class and board from the session picker override the profile's.

### 6.3 Session memory — `src/memory/sessionMemory.ts`

Stored in `session_context(session_id PK, data JSON, upto_turn_id, updated_ts)`:

```ts
{ topic, gist /* ≤150 words */,
  lesson: { goal, chunks: [{ title, status: pending|explained|understood|struggling }], next },
  student: { understood[], struggling[], misconceptions[] },
  last_offer: example|next_chunk|quiz|null }
```

- **Validation:** everything from the LLM passes through `normalizeSessionMemory(raw, prev)`. It caps the plan at 8 chunks and each list at 5 items, clamps `next`, defaults unknown statuses, and keeps the previous value for any malformed field. A bad update cannot corrupt the store.
- **Loaded:** when a session opens or resumes, and before every answer.
- **Migration:** existing rolling summaries became each session's `gist`. `summarizer.ts` was removed; the updater replaces it.
- **History replayed verbatim:** 12 messages (Groq and Gemini). Older turns live in the gist.

### 6.4 Learner profile (global) — `src/memory/learnerProfile.ts`

Stored in `learner_profile(key PK, value JSON, updated_ts, source_session_id)`.

- **Allowed keys only:**
  - single values: `name`, `class`, `board`, `school`, `city`, `exam_goal`
  - lists (up to 8 items, deduped): `interests`, `learning_preferences`, `strengths`, `difficulties`, `notes`
- **Only what the student said about themselves.** Sensitive categories are refused twice: the extractor is told not to record them, and a server-side filter drops religion or caste words, health conditions, money, phone/e-mail/address, digit runs and "@".
- **Student control:**
  - "Remember things about me" switch (`meta.memory_enabled`). While it is off, session memory still works but no personal facts are written.
  - "About you" tab: see every fact, delete one item or one fact, or forget everything.

### 6.5 The memory updater — `src/memory/memoryUpdater.ts`

- **Trigger:** `updateMemoryBackground(sessionId)` after every stored answer, but not after the opener.
- **Runs:** serial per session; exchanges that arrive during a run are folded into the next one.
- **Input:** the previous memory, the profile, the session language, and up to 6 new turns since `upto_turn_id`.
- **The call:** one `completeJson` call (`src/llmText.ts`), using Groq `json_object` mode or Gemini JSON MIME type, with low reasoning effort. A reply wrapped in prose or code fences is still parsed. Output: `{ memory, profile_facts }`.
- **On failure:** the previous memory is kept, and the same turns are retried next time.
- **After success:** the server pushes `session_context` (topic, chunks, next, gist) to the client.

### 6.6 The opener

- **Flow:** `openSession` (`src/sessionLifecycle.ts`) emits the internal `session_opener` event after a short delay (`OPENER_DELAY_MS`, default 400). The state machine has one new row, IDLE → LLM_STREAMING with `START_LLM_STREAM`. An **ephemeral** instruction (in memory only, never stored) stands in for the student's turn.
- **New session:** a one-sentence greeting (by name if known), then "what would you like to learn today?".
- **Resumed session:** a welcome back, a one- or two-sentence recap from the gist, then an offer to continue with the next chunk (named) or start something new.
- **Not stored:** opener replies are spoken and kept in the in-memory history, so "yes, continue" makes sense to the model. They are **not** stored, summarised or titled.

### 6.7 Client

- **"This session" tab:** a lesson-progress card showing the topic, "N of M understood", each chunk with a status dot, and "Up next".
- **"About you" tab:** described in §6.4.
- **API:**
  - `GET /api/profile`
  - `DELETE /api/profile`
  - `DELETE /api/profile/:key[?item=]`
  - `PATCH /api/settings {memory_enabled}`
- **Protocol:** S→C `session_context {session_id, topic, gist, chunks, next}`.

### 6.8 Verified

- **Unit tests:** 155 pass. New suites: `teacher.test.ts`, `memory.test.ts` (normaliser, profile filters and switch, serial updater with a mocked LLM, JSON parsing), and the `session_opener` state row.
- **Mock end-to-end:**
  - The opener greets and asks the topic.
  - After turn 1 ("I love cricket. Can you explain photosynthesis?"), the background update stores a 3-chunk plan and remembers `interests: cricket`. A planted `religion` fact is dropped.
  - Turn 2's prompt contains the lesson, "2. Chlorophyll captures sunlight (not yet taught) ← teach this next", the pending example offer, and the cricket interest.
  - Resuming the session gives an opener that recaps from the gist and offers "Chlorophyll captures sunlight". The client gets `session_context` immediately.
  - Opener replies are not stored.
- **Not yet verified:** live quality with the real model. `openai/gpt-oss-20b` may follow the method loosely; if so, set `GROQ_MODEL=openai/gpt-oss-120b` and keep `SUMMARY_MODEL` small.

---

## 7. Phase 3 — Live notes beside the lesson, and a PDF (implemented)

### 7.1 Overview

```
answer stored ─► (background, serial per session, only while notes are on)
                 notes agent (src/notes/notesAgent.ts): one JSON LLM call
                   in:  notebook outline (ids + short text), lesson topic and plan,
                        new turns since notebooks.upto_turn_id, language, class/board
                   out: NotesPatch {should_record, subject, topic, ops[]}
                 applyNotesPatch (pure) ─► notebooks table ─► S→C notes_update ─► docked Notes panel
                                                          └─► PDF re-render, debounced 5 s ─► data/notes/<session>.pdf
```

Notes are a separate background call from the session memory (§6.5). Memory is compact English; notes are content-rich, in the student's language. Both run through `src/util/serialJobs.ts`: one run at a time per session, with triggers that arrive mid-run folded into one more run.

### 7.2 The notebook — `src/notes/notebook.ts`

- **Shape:** `{ subject /* the headline */, topic, sections: [{ id, heading, blocks: [{ id, kind, text, latex? }] }], version }`. Block kinds: `definition`, `point`, `formula` (with LaTeX), `example`, `tip` ("Remember"), `question` ("Practice").
- **`applyNotesPatch(nb, patch)`** is pure, and it is the only way the notes change:
  - **ids:** assigned server-side (`s1`, `b1`…); the LLM can only refer to ids it was shown in the outline.
  - **Ops:** `add_section` (merges into an existing section with the same heading), `append`, `update_block`. Anything else is ignored.
  - **Duplicates:** skipped, ignoring case, spaces and punctuation, including the danda. A section is only created if one of its blocks is new.
  - **Caps:** 40 sections, 30 blocks per section, 400 characters per block. The version moves only on a real change.
- **Prompt input:** `outlineOf(nb)` gives a compact view (ids and the first ~60 characters of each block), so the prompt stays small as notes grow.

### 7.3 The notes agent — `src/notes/notesAgent.ts`

- **Runs:** after every stored answer (not after the opener), only while notes are on for the session.
- **Prompt rules:**
  - Written in the session language; Hinglish keeps Hindi in Devanagari and English in Latin script, and English technical terms go in brackets.
  - A topper's-notebook style: one idea per block, "Term: meaning" definitions, formulas with LaTeX plus what each symbol means, one example per idea, tips for memory aids and common mistakes.
  - Only what the teacher taught. Small talk gives `should_record: false`.
  - Sections follow the Phase 2 lesson plan when there is one. The headline is the school subject.
- **On failure:** the notes are unchanged and the turns are retried next time. If the student switched notes off while the call was out, its result is dropped.
- **Storage:** `notebooks(session_id PK, enabled, doc, upto_turn_id, updated_ts)`. Deleting a session deletes its notebook and PDF.

### 7.4 On and off: by default, by switch, by voice

- **Default:** notes are **on by default** for new sessions (`meta.notes_default`, a switch in the panel: "Make notes in new sessions").
- **Opener:** with notes on, the new-session opener says it will keep notes and that the student can say "no notes".
- **Switch:** the panel switch sends C→S `set_notes`. Switching on catches up on the turns since the last notes.
- **Voice:** "no notes", "notes mat banao", "make notes again" in any language. The Phase 2 memory updater reports `notes_request: on | off | null` from the new turns and applies it. There is no tool-calling path, no filler speech and no state-machine change. The teacher prompt knows whether notes are on and simply agrees when asked.

### 7.5 PDF — `src/notes/pdf.ts`

- **Engine:** `playwright-core` drives the **system Google Chrome** (`channel: 'chrome'`; `PDF_BROWSER_CHANNEL` or `PDF_BROWSER_PATH` to override). There is no browser download and no bundled fonts: the system Noto fonts cover every supported script, and Chrome shapes them correctly (ADR G18). The browser launches lazily on first use, is reused, and closes after 60 s idle.
- **HTML:** `renderNotesHtml` is pure:
  - a header with the brand, the **subject as headline**, the topic, the session title, class/board, language and date
  - sections with headings, points as lists, and coloured boxes per block kind
  - formulas rendered with `katex.renderToString`, with KaTeX CSS and fonts loaded from `node_modules` via a `file://` page
  - all text HTML-escaped
- **"Simultaneous":** a render runs 5 s after each notes change (debounced), writing `data/notes/<id>.pdf` plus its version. A download serves the file if current, otherwise renders on the spot. Renders are deduplicated per session.
- **Routes:**
  - `GET /api/notes/:id` returns notebook JSON.
  - `GET /api/notes/:id/pdf` returns the PDF, as `attachment` with a UTF-8 filename such as `भौतिकी (Physics).pdf`. The id is validated, and the file path is built only from it.
- **Graceful disable:** if Chrome can't be launched, `pdf_available: false` with the reason; the Download button shows it, and the in-app notes keep working.

### 7.6 Client — `client/src/components/NotesPanel.tsx`

- **Layout:** a **docked panel beside the lesson**: `.workspace` puts the stage and the panel side by side, and below 900 px the panel becomes a slide-over. The header's **Notes** button hides or shows it; the choice is remembered per device, and a dot appears when new notes arrive while it is hidden.
- **Content:** the subject headline and topic, then sections and blocks styled by kind. Formulas render with KaTeX (client dependency).
- **New notes glow for 2.5 s,** so the student sees them appear while listening. The panel follows new notes only while you are at the bottom.
- **Controls:** the notes switch, **Download PDF** (fetched, so an error shows its reason instead of saving an error page), and the new-session default.
- **Protocol:**
  - S→C `notes_update {session_id, enabled, default_enabled, notebook, pdf_available, pdf_reason}`, sent on open, on every change and on toggle
  - C→S `set_notes {session_id, enabled}`

### 7.7 Verified

- **Tests:** 176 pass. New suites:
  - `notebook.test.ts`: ids, merges, duplicates, caps, version, robustness
  - `notes.test.ts`: the default, the agent with a mocked LLM, catch-up after switching on, failure safety, voice off and on through the memory updater, HTML escaping and KaTeX, and **real PDF renders through system Chrome**
- **Mock end-to-end, in Hindi:**
  - The opener mentions notes.
  - Turn 1 gives the headline "भौतिकी (Physics)" with a definition and an example (v1, PDF pre-rendered). Turn 2 appends `F = ma` (v2, re-rendered).
  - The download is a 48 KB PDF named `भौतिकी (Physics).pdf`, with correctly shaped Devanagari and the KaTeX formula (checked visually).
  - "notes mat banao" turns notes off, and the next turn makes no notes call.
- **Not yet verified:** the quality of notes from the real model.

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Network STT and TTS add latency compared to local engines | Frames stream during speech. The Prisma socket and the Timbre queue are always warm. First-fragment flush at 250 ms. New `[latency] TTS first audio` marker to measure. |
| The 16-frame pre-roll on `speech_start` reaches Gnani as a burst, against the "real-time cadence" rule | Watch transcript quality. If it degrades, pace the pre-roll at about 8 ms per frame in `gnaniStt`. |
| Unclear which script `hi-en` (Hinglish) TTS prefers | Test both Devanagari and Roman input on first run, then fix the Hinglish LLM directive to match. |
| Vosk models don't exist for every Indic language | By design, captions are simply off for those languages. The Prisma final still shows. |
| 15-minute STT session cap | Lazy reconnect on the next utterance. Frames queue while the socket reopens, so no audio is lost; the cost is one TLS handshake on that turn. |
| API cost per turn | One persistent socket for each of STT and TTS. Sentence merging cuts the TTS request count. |
| The API changes (docs were inconsistent between api.gnani.ai and api.vachana.ai) | URLs and models are env-configurable. The values used come from docs.gnani.ai (Nov 2026). |

---

## 9. Verification

1. `npx tsc --noEmit` and `npm test` at the root. Tests cover the state machine (renamed), the sentence buffer, `sanitizeForTTS`, `gnaniStt` and `gnaniTts`. The Gnani tests run against a **local mock Gnani WebSocket server** and check 1024-byte framing, commit aggregation, timeouts, even-length PCM, the serial queue and cancellation.
2. `cd client && npm run build && npx eslint .`.
3. **Live smoke** (needs a real key):
   - `npm run smoke:gnani -- tts "नमस्ते, आज हम प्रकाश संश्लेषण पढ़ेंगे।" hi` writes `data/smoke-tts.pcm` and reports its length. Play it with `ffplay -f s16le -ar 22050 -ac 1 data/smoke-tts.pcm`.
   - `npm run smoke:gnani -- stt speech.wav hi` streams a 16 kHz mono file at real-time cadence and prints the transcript.
4. **End to end:**
   1. `cd client && npm run build`, then `npm start`, then open http://localhost:3000.
   2. Choose Hindi with Class 9 CBSE, start, and ask "न्यूटन का पहला नियम क्या है?".
   3. Expect a Devanagari transcript, a spoken Hindi reply, and `[latency]` logs.
   4. Switch to Tamil while idle and confirm reconnect logs and a Tamil reply.

---

## 10. Phase 4 — App shell, typed input, voice off, complete speech (implemented)

### 10.1 Why
Live use showed:
- no home page, and a crowded setup overlay
- overlapping Sessions/Notes/Log panels
- Connect/Mute shown everywhere
- long answers cut off at the panel edge
- voice-only input
- dark-only theme
- spoken audio missing the last lines of long answers

### 10.2 The app shell (client)
- **Routes** (`client/src/router.ts`, pushState, no dependency):
  - `/` Home
  - `/new` New session
  - `/s/<id>` the session
  - `/settings`

  The server answers every extension-less path with `index.html`, so Back/Forward and reloads work.
- **Sidebar** (`Sidebar.tsx`): New session, search, groups (⋯: new session here / rename / delete), recent sessions as links (⋯: rename / move / delete), Settings, theme switch. Below 900 px it becomes a drawer.
- **Pages:** `HomePage` (what GuruAI is, continue/start, features, how it works), `NewSessionPage` (one compact form: language select, filterable voice list with samples, class/board, group), `SessionPage`, `SettingsPage`.
- **State:**
  - `library.ts` (sessions, groups, voices; React context)
  - `useVoiceSession` (one session on one socket: thread, mic gating, playback, notes, lesson, log)
  - `settings.ts` (per-device choices)
- **The session screen:**
  - header: title, language badge, voice select with ▶ sample, Notes, End
  - `Thread`: one chat column; the audio-paced reveal is kept, and it is instant when voice is off
  - `Composer`: mic, auto-growing text box, Send, Stop, 🔊
  - **one** `SidePanel` with Notes / Lesson / Log tabs: docked at ≥1100 px, a slide-over below

  The mic and composer exist only here.
- **Themes:** tokens in `styles/tokens.css`. Light is on `:root`. Dark applies under `prefers-color-scheme` unless `data-theme="light"`, and under `data-theme="dark"`. An inline script applies the saved theme before first paint. The orb reads its colours from CSS variables.

### 10.3 Typed input and voice off (server)
- `text_input` (IDLE only; otherwise a recoverable `INVALID_STATE`):
  - stops any speech still playing (`interruptSpeech`, reason `new_question`)
  - echoes `transcript_final` and persists through `acceptUserTurn`, shared with `stt_final`
  - then runs the new row `IDLE + text_input → LLM_STREAMING [START_LLM_STREAM]`
- `set_voice_output` / `session_init.voice_output`: a connection-level flag. When off, the sentence callback never calls Timbre, and switching off mid-answer interrupts it.
- `stop_speaking`: `interruptSpeech` (reason `stopped`).
- One session at a time, **newest connection wins**. A new socket retires the old one (close 4000), and the old one's late messages and close are ignored. Moving between session pages opens a fresh socket.

### 10.4 Why long answers lost their end — and the fix
Measured with `npm run smoke:tts-long` against the real API: a 15-sentence Hinglish answer gave 50.8 s of audio, against about 90 s expected.

**Cause.** A raw socket dump showed Timbre ends **every** request with two `complete` messages:

```
complete {data:{is_final:true}}
complete {message:"Streaming completed"}
```

The client treated each as the end of a request:
- After the first, it sent the next sentence.
- The trailing summary then "completed" that next sentence before any of its audio arrived.
- From then on, every sentence's audio was attributed one slot late.
- The final sentences' audio arrived after the queue had drained and was discarded.

**Fix** (`gnaniTts.ts`):
- the end-of-audio message completes the request
- the summary that follows is expected and swallowed (`pendingSummaries`, reset on `start` and on socket close)
- audio with no request in flight is counted and logged, never silently dropped

**Result.** After the fix, the same answer gives **94.2 s**, and every sentence carries audio proportional to its text.

**No silent skips any more:**
- A sentence that gets an `error`, stalls, or loses its socket after audio began is retried once over REST (`gnaniTtsRest.ts`). Already-played bytes are skipped, and the order is kept.
- If that also fails, a long sentence is split in two and retried.
- Each run reports `spoken N/M, failed [...]`. `tts_state` carries `spoken` / `failed`, and the client log shows the seconds of audio received.

### 10.5 Verified
- **186 server tests**, including:
  - the double-complete regression
  - the REST second chance (in order, without repeating played audio)
  - the split
  - `text_input` state-machine rows
- **Mock end-to-end (32 checks):**
  - the typed question is echoed
  - mid-answer typing is refused politely
  - voice off makes zero TTS requests and sends no audio
  - voice on speaks every sentence, with REST fallback for the failing one
  - stop interrupts
  - a new connection retires the old one and resumes with history
  - SPA fallback works
- **Browser checks (real Chrome)** across Home, New session, Session, Settings, in light and dark, at 1440, 1024 and 390 px:
  - no horizontal scroll
  - no mic outside a session
  - Back/Forward works
  - notes and KaTeX render
  - the theme switch works
  - the voice toggle persists
  - the drawer and slide-over work

