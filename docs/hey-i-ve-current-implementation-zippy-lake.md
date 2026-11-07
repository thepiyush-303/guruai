# GuruAI — Migration to Gnani (Prisma STT + Timbre TTS) and Study-Teacher Design

## Context

The repo today is "Vani", a general voice assistant. The browser runs Silero VAD and sends 16 kHz PCM over a WebSocket. Final STT is local Faster-Whisper, live captions come from local Vosk, and the LLM is Gemini or Groq. TTS is local Piper, which only does English. All of this runs through a pure state machine (`src/stateMachine.ts`) and a side-effect dispatcher (`src/sideEffects.ts`).

The goal is **GuruAI**, a voice study teacher for Indian students:
- It speaks and listens in the language the student picks (10 Indic languages plus Hinglish). This uses Gnani's **Prisma** (STT) and **Timbre** (TTS) APIs.
- It teaches properly, as a structured explainer adapted to class and board, not a one-line chatbot.
- It builds **live study notes** in a sidebar. The notes are titled by subject and grow as the student asks questions, in the chosen language. They render to a **PDF**, and the student can turn notes on or off.

**This round's scope (user decision):** write the detailed design doc into the repo, then implement **Phase 1 only**: the Gnani migration, the language selection and the session-preferences plumbing. Phases 2 (teacher persona) and 3 (notes and PDF) are designed in full in the doc but not built yet.

**User decisions recorded:** PDF is rendered server-side with headless Chromium (Playwright). Whisper and Piper are removed entirely. **Vosk is kept for live captions only.** The session-start picker covers class and board.

---

## Deliverable 0 — Design documentation (written first)

- New file **`.claude/guruai-design.md`**: the full design below (Phases 1–3, protocol, data model, risks).
- Append ADRs G1–G8 (decisions below) to **`.claude/decisions.md`** in its existing format.
- Replace the pointer section of **`.claude/todo.md`** with a GuruAI phase tracker. Keep the old Vani history below it, marked as superseded.
- Update `PROJECT_DEEPDIVE_PRD.md` §1–2 to describe the Gnani pipeline. Only the parts that become false change.

### Key decisions (ADRs)
| # | Decision | Why |
|---|---|---|
| G1 | Prisma STT over the **realtime WebSocket**, streaming frames *during* speech; `{"type":"commit"}` on client `speech_end` | Transcription overlaps speech, so the final arrives sooner than with REST upload after speech. The client's 512-sample/1024-byte frames already match Gnani's required frame size exactly. |
| G2 | Client Silero VAD stays authoritative for turn boundaries; the Gnani server VAD is set loose (`x-min-silence-ms: 2000`) | Keeps the existing state machine and gating unchanged. Gnani never splits a student's thinking pause into two turns. |
| G3 | Timbre TTS over a **persistent WebSocket** with a serial FIFO queue, `container: raw`, `encoding: pcm_s16le`, `sample_rate: 22050` | The docs allow one request at a time per connection. At 22050 Hz raw PCM, the client player and the `[0xAF][0xFE][seq]` framing stay byte-identical. |
| G4 | Keep Vosk for display-only live captions with a **per-language model map**. No model for a language means no live captions; the Prisma final still shows | Prisma returns finals only (no interims), and the user wants live text. |
| G5 | Default models: `prisma-v3.0` and `timbre-v3.0`, overridable through env | Prisma v3.0 adds `indic-auto`, codemix and keyterms. All 13 Timbre v3.0 voices speak all 10 languages, so one voice setting works everywhere. |
| G6 | Language is a **session preference**, sent in `session_init` and changeable in IDLE through `update_preferences`. A change reconnects STT/TTS and restarts Vosk | Gnani STT headers are fixed per connection. |
| G7 | Remove Faster-Whisper and Piper code and dependencies. Git history keeps them | User decision. |
| G8 | Notes PDF uses Playwright Chromium with bundled Noto fonts (Phase 3) | Only a browser engine shapes Indic conjuncts correctly. pdfkit and jsPDF do not. |

---

## Phase 1 — Gnani migration and language selection (IMPLEMENT NOW)

### 1.1 Language table — new `src/languages.ts`
A single source of truth used by the server, and mirrored in `client/src/protocol.ts`.

```ts
type LanguageId = 'en'|'hi'|'hinglish'|'bn'|'gu'|'kn'|'ml'|'mr'|'pa'|'ta'|'te';
interface LanguageConfig {
  id; label; nativeLabel;          // "Hindi", "हिन्दी"
  sttLanguageCode;                 // 'hi-IN' | hinglish: 'hi-IN,en-IN'
  sttFormat;                       // 'transcribe' | hinglish: 'codemix'
  ttsLanguage;                     // 'hi-IN' | hinglish: 'hi-en'
  llmDirective;                    // "Reply only in Hindi, Devanagari script; keep technical terms in English in brackets"
  voskModelEnv;                    // 'VOSK_MODEL_PATH_HI'
  fillerPhrase;                    // "एक क्षण रुकिए।"
}
```

### 1.2 Gnani STT client — new `src/gnaniStt.ts` (replaces `src/whisperProcess.ts`)
It keeps the shape of the old module's API so `sideEffects.ts` changes stay small: `configure(lang)`, `connect()`, `beginUtterance()`, `writeChunk(pcm)`, `commit()`, `discard()`, `stop()`, `onSttEvent(cb)`.
- **Connection:** `wss://api.vachana.ai/stt/v3/stream` using the `ws` package with these headers: `x-api-key-id`, `model`, `language_code`, `format`, `x-sample-rate: 16000`, `x-min-silence-ms: 2000`, `x-idle-timeout-sec: 300`, and `keyterms` (v3.0) or `bias_list` (v2.5) built from the existing `vocab.txt` / `VANI_VOCAB` loader. The client connects eagerly on session init or a language change, and reconnects lazily on the next `speech_start` after a close (15-minute cap = close 1001, or idle timeout).
- **Framing:** a re-chunker guarantees exactly 1024-byte binary frames, splitting or holding remainders and zero-padding the last frame before a commit. Frames that arrive while the socket is still opening go into a bounded queue (about 10 s) and flush on open.
- **Utterance aggregation:** this is the subtle part.
  - Track `segmentOpen`: true on the server's `speech_start` message, false on `transcript`. Collect `transcript.text` segments for the current utterance.
  - On `commit()`: if a segment is open, wait for its `transcript`, then emit `final = segments.join(' ')`. If no segment is open, emit right away. If no segment was ever opened, emit an empty final after a 1.5 s grace period; this falls into the existing empty-transcript → IDLE path.
  - A hard timeout of 6 s → `error` (STT_FAIL).
  - Also emit `detected_language_code` and Gnani's `latency` for logging.
- **`discard()`** (VAD misfire) ignores segments until the next `beginUtterance()`.
- If `GNANI_API_KEY` is missing, log a clear warning at startup and fail each turn with a recoverable `STT_FAIL`. This follows the graceful-disable pattern in `contextStore.ts`.

### 1.3 Gnani TTS client — new `src/gnaniTts.ts` (replaces `src/piperProcess.ts`)
API: `configure(lang)`, `start()`, `synthesize(text, ws)`, `sendFillerPhrase(ws)`, `kill()`, `stop()`.
- **Connection:** persistent `wss://api.vachana.ai/api/v1/tts` with header `X-API-Key-ID`, reconnecting with backoff when closed.
- **Queue:** `synthesize()` pushes onto a FIFO. The worker sends one JSON request `{text, voice, model, language, speed, audio_config:{sample_rate:22050,num_channels:1,sample_width:2,encoding:'pcm_s16le',container:'raw'}}` and waits for `complete` or `error` before sending the next. Because Gnani streams audio faster than real time, sentence N+1 synthesizes while the browser plays sentence N.
- **Audio:** base64-decode each `audio` message. Defensively strip a `RIFF…data` header if one is present. Carry an odd trailing byte so every frame payload is **even-length**; the client's `new Int16Array(...)` would throw otherwise. Then reuse the existing 4 KB re-chunking and `[0xAF][0xFE][uint16 seq]` framing, moved verbatim from `piperProcess.ts` (`buildFrame`, `sendPcmChunk`, `flushPcmBuffer`, idle flush) into **`src/ttsFraming.ts`**.
- **`kill()`** (barge-in or error): clear the queue, tag the in-flight request as cancelled (drop its later audio), close the socket so the server stops generating, reset `frameSeq`, and reopen lazily.
- The filler phrase is localized through `LanguageConfig.fillerPhrase`.

### 1.4 Sentence buffer retuned for network TTS — `src/sentenceBuffer.ts`
Each Piper fragment cost almost nothing. Each Timbre request costs a network round trip, and tiny fragments sound choppy.
- Boundaries are `. ? !` plus Devanagari/Bengali `।` `॥` and newlines. A comma or semicolon only counts as a boundary once the buffer holds 80 characters or more.
- `MIN_CHUNK_CHARS = 24`. The first-chunk flush timeout is about 250 ms and later ones about 600 ms. A hard cap of about 220 characters splits at the last space.
- `sanitizeForTTS` (`src/ttsUtils.ts`) also strips markdown symbols (`* # _ \``) and emoji.
- Update `src/__tests__/ttsUtils.test.ts` and add `sentenceBuffer.test.ts`.

### 1.5 State machine, side effects and message routing — rename only, same transitions
- `src/types.ts`:
  - Events: `whisper_final` → `stt_final`, `whisper_error` → `stt_error`; drop `whisper_partial` and `wake_word_detected`.
  - Side effects: `OPEN_WHISPER_PIPE` → `OPEN_STT_STREAM`, `SEND_EOF_TO_WHISPER` → `COMMIT_STT`, `DISCARD_WHISPER_BUFFER` → `DISCARD_STT`, `SPAWN_PIPER` → `START_TTS`, `KILL_PIPER` → `STOP_TTS`.
  - Remove `SessionContext.audioBuffer`, since frames now stream live. Add `preferences: SessionPreferences`.
- `src/stateMachine.ts`: mechanical renames only. Every transition row stays the same. Update `src/__tests__/stateMachine.test.ts` to match.
- `src/sideEffects.ts`:
  - Use `gnaniStt` and `gnaniTts` in place of `whisperProcess` and `piperProcess`.
  - `initSubprocesses` becomes `initSpeechServices`, which starts Vosk and opens the TTS socket.
  - Drop the weather/Todoist tool wiring from the default toolset. The modules stay in `src/tools/` but are not registered (they don't belong in a teacher).
- `src/messageHandler.ts`:
  - `handleBinaryMessage` in LISTENING calls `gnaniStt.writeChunk(buf)` and `voskProcess.writeChunk(buf)`.
  - Handle the new `update_preferences` message. It is accepted only in IDLE; otherwise it gets an INVALID_STATE error.
  - Rename the whisper cases to stt.
  - The Vosk caption logic stays as it is.
- `src/server.ts`:
  - Read `preferences` from `session_init` (default `en`) and call `applyLanguage(prefs)`, which runs `gnaniStt.configure`/`connect`, `gnaniTts.configure`, and `voskProcess.setModel(path)`.
  - Send `preferences_ack`.
  - Replace the Whisper/Piper shutdown calls.

### 1.6 Vosk per-language live captions — `src/voskProcess.ts`, `vosk_server.py`
- Add `setModel(path | null)`, which restarts the Python process with the new `VOSK_MODEL_PATH` (it already gives up cleanly when a model is missing).
- The model comes from `VOSK_MODEL_PATH_<LANG>` env vars, for example `vosk-model-small-en-in-0.4` (Indian English) and `vosk-model-small-hi-0.22`. Hinglish falls back to the Hindi model, then the English one.
- `preferences_ack.live_captions` tells the UI whether captions are available. When they aren't, the user caption shows a "listening…" pulse until the Prisma final arrives.
- `vosk_server.py` is unchanged.

### 1.7 LLM language plumbing (minimal persona change this round)
- `src/session.ts` `createSession(id, prefs)`: the system prompt becomes "You are GuruAI, a patient teacher for Indian students…", plus `llmDirective`, plus a spoken-output rule ("write numbers and formulas as spoken words") and class/board context. Fully detailed teaching behavior arrives in Phase 2.
- **Fix in `src/geminiStream.ts`:** today it ignores the session's system message, uses the hardcoded `SYSTEM_PROMPT`, and maps the `system` role into a *user* turn. Build `systemInstruction` from `conversationHistory[0]` and drop `system` messages from `contents`. Remove the weather/Todoist declarations; Google Search grounding stays.
- `src/groqStream.ts`: use the session's system message in place of its hardcoded prompt. Keep `capHistory`.

### 1.8 Wire protocol changes (`src/types.ts` and `client/src/protocol.ts`, kept in sync)
| Dir | Message | Change |
|---|---|---|
| C→S | `session_init` | + `preferences: { language: LanguageId; grade?: string; board?: 'CBSE'\|'ICSE'\|'STATE'\|'OTHER' }` |
| C→S | `update_preferences` | **new**, IDLE only |
| S→C | `preferences_ack` | **new**: `{ preferences, live_captions: boolean, tts_voice }` |
| S→C | `transcript_partial` / `transcript_final` | unchanged (Vosk / Prisma); final + `detected_language?` |
| S→C | binary TTS frames | **unchanged** (22050 Hz s16le, `0xAF 0xFE seq`) |
| C→S | `wake_word_detected` | removed |

### 1.9 Client — `client/src/`
- New `components/SessionSetup.tsx`, shown while disconnected:
  - A language grid with native labels (हिन्दी, தமிழ், …), a class picker (6–12, College) and a board picker. Saved to `localStorage` inside try/catch.
  - "Start learning" connects. `useWsClient` passes the preferences into `session_init`.
- While connected, the rail shows a language chip. Changing it in IDLE sends `update_preferences`.
- `App.tsx`: rename "Vani" to "GuruAI". Handle `preferences_ack`. Show the "listening…" pulse when `live_captions` is false.
- `index.css` + `index.html`: Google Fonts Noto Sans plus the Devanagari, Bengali, Gujarati, Gurmukhi, Kannada, Malayalam, Tamil and Telugu variants, as a font stack for captions.
- `hooks/useVadMic.ts`: raise `redemptionFrames` from 4 to about 12 (about 380 ms), so students can pause mid-thought without ending the turn. Make it a named constant.
- `useAudioPlayback` is unchanged, since the format is unchanged.

### 1.10 Removal and config
- Delete `faster_whisper_server.py`, `src/whisperProcess.ts` and `src/piperProcess.ts`.
- `requirements.txt` → `vosk==0.3.45` only.
- `package.json`: rename to `guruai`. No new dependencies; `ws` covers both Gnani clients.
- `.env.example`: drop the WHISPER and PIPER blocks and add:
  ```
  GNANI_API_KEY=
  GNANI_STT_MODEL=prisma-v3.0
  GNANI_TTS_MODEL=timbre-v3.0
  GNANI_TTS_VOICE=Shivani
  GNANI_TTS_SPEED=1.0
  GNANI_STT_URL=wss://api.vachana.ai/stt/v3/stream
  GNANI_TTS_URL=wss://api.vachana.ai/api/v1/tts
  VOSK_MODEL_PATH_EN=models/vosk-model-small-en-in-0.4
  VOSK_MODEL_PATH_HI=models/vosk-model-small-hi-0.22
  ```
- The API key stays server-side only and never reaches the browser.

---

## Phase 2 — Teacher persona (DESIGN ONLY, documented in the doc)
- **Teaching loop prompt** (`src/prompts/teacher.ts`):
  1. Intuition first.
  2. An everyday Indian analogy (cricket, trains, chai, monsoon, markets).
  3. A step-by-step worked example.
  4. A one-line recap.
  5. A check-for-understanding question.
  Spoken chunks run about 120–220 words, then "Shall I go deeper or give an example?". The prompt is aligned to the selected class and board (NCERT for CBSE). Formulas are spoken aloud ("v equals u plus a t"); the written form goes into the notes.
- **Session opener:** the first assistant turn greets the student in their language, asks what they want to learn today, and asks whether to prepare notes (this feeds the Phase 3 `set_notes` tool).
- **Limits:** `MAX_TOKENS` about 1024. History cap rises from 8 to 16 messages. The rolling summary becomes per notebook, not global.
- **Misconception handling:** if the student's answer to the check question is wrong, the teacher re-explains from a different angle instead of repeating.

## Phase 3 — Live notes and PDF (DESIGN ONLY, documented in the doc)
- **Notes agent** (`src/notes/notesAgent.ts`):
  - Runs off the hot path after each `llm_stream_complete`.
  - A serial per-notebook worker that merges jobs queued while it is busy.
  - Makes a JSON-mode LLM call (Gemini `responseSchema`) with the current outline and the new exchange, and returns a `NotesPatch`: `{ should_record, subject?, topic?, ops:[add_section | append_blocks | update_block] }`.
  - Block kinds: `point`, `definition`, `formula` (LaTeX), `example`, `tip`, `question`.
  - Chit-chat gets `should_record: false`. The first substantive question sets the title to the subject name (for example "भौतिकी (Physics)") and adds topic, date, class and board. A topic switch adds a new section.
- **Pure `applyNotesPatch(doc, patch)`** (unit-tested). Notebooks persist in a new SQLite table `notebooks(id, session_id, title, subject, language, grade, board, notes_enabled, doc_json, version, created_ts, updated_ts)` in `contextStore.ts`.
- **Protocol:** S→C `notes_update {notebook_id, version, doc}`. C→S `set_notes {enabled}`. The LLM gets a `set_notes(enabled)` tool so the student can say "notes banao" or "notes mat banao". This tool skips the filler TTS because it completes instantly.
- **Client:** a collapsible `NotesSidebar.tsx` that renders blocks with KaTeX formulas, briefly highlights new blocks, and has a notes on/off toggle and a "Download PDF" button.
- **PDF** (`src/pdf/renderNotes.ts`):
  - An HTML template using bundled Noto fonts in `assets/fonts/` and server-side `katex.renderToString`.
  - One lazily launched Playwright Chromium renders it with `page.pdf({format:'A4'})`.
  - The PDF regenerates 5 s after the last notes update (debounced) and is saved as `data/notes/<uuid>.pdf`.
  - It is served at `GET /notes/<uuid>.pdf`, with the id validated against a UUID regex.
  - If Playwright isn't installed, PDF is disabled gracefully.

---

## Risks
- **Latency:** STT and TTS move from local processes to the network. Prisma latency is logged next to `sttFinalAt`, and Timbre time-to-first-audio gets a new `ttsFirstAudioAt` marker. Streaming STT and the queued TTS pipeline are the mitigation.
- **Pre-roll burst:** the 16 pre-roll frames sent all at once on `speech_start` break Gnani's "real-time cadence" rule. If transcripts degrade, pace them at about 8 ms intervals.
- **Hinglish TTS script:** it's unverified whether `hi-en` prefers Devanagari or Roman text. Test both during verification and set `llmDirective` to match.
- **Vosk coverage:** small Vosk models exist only for some languages. Languages without one silently lose live captions, which is by design.
- **API facts:** the API facts come from docs.gnani.ai (Nov 2026). Model and voice names should be verified against the live API on the first run.

## Verification
1. Root: `npx tsc --noEmit` and `npm test`. The state-machine tests are updated for the renames. New tests:
   - `gnaniStt.test.ts` and `gnaniTts.test.ts` run against a **local mock Gnani WebSocket server** built with `ws`. They cover 1024-byte framing, commit aggregation (open segment, no segment, multiple segments), timeouts, base64 to even-length PCM frames, the serial queue and kill/cancel.
   - `sentenceBuffer.test.ts` and `ttsUtils.test.ts`.
2. Client: `cd client && npm run build && npx eslint .`.
3. Live API smoke (user hardware, real `GNANI_API_KEY`):
   - A scratch script sends one Hindi sentence to Timbre and checks for even-length raw PCM at 22050 Hz.
   - It streams a recorded 16 kHz PCM file to Prisma and prints the transcript.
4. End to end: `cd client && npm run build`, then `npm start`, then open http://localhost:3000.
   - Pick Hindi and Class 9 CBSE, connect, and ask "न्यूटन का पहला नियम क्या है?".
   - Expect: a live Vosk caption (if the Hindi model is present), a Prisma final in Devanagari, a spoken Hindi reply, and `[latency]` logs.
   - Switch to Tamil in IDLE and confirm the STT/TTS reconnect logs and a Tamil reply.
   - Test a VAD misfire, the empty-transcript path and an LLM error path.
