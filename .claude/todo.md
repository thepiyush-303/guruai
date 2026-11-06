# TODO — GuruAI (live tracker)

> The single source of truth for **what is being worked on right now**.
> Plan lives in `plan.md`; how in `architecture.md`; why in `decisions.md`.
> Update this file as phases start/land (CLAUDE.md: goal-driven execution).

**Last updated:** 2026-09-05 (Phase 2 frontend code-complete)

---

## ▶ Current pointer## ▶ Current pointer — GuruAI (2026-11-06)

The project is now **GuruAI**, a multilingual voice study teacher on Gnani.ai (Prisma STT + Timbre
TTS). Design: `guruai-design.md`. Decisions: G1–G8 in `decisions.md`.

### Phase G1 — Gnani migration + language selection  `[~] code complete, pending live-API validation`
- [x] `src/languages.ts` language table (10 languages + Hinglish)
- [x] `src/gnaniStt.ts` Prisma realtime client (1024-byte framing, commit aggregation, misfire discard)
- [x] `src/gnaniTts.ts` Timbre realtime client (serial queue, raw s16le 22050 Hz, cancel)
- [x] `src/ttsFraming.ts` (framing moved from Piper, even-length payloads, WAV-header guard)
- [x] Sentence buffer retuned for network TTS (danda, min/max lengths)
- [x] State machine and effect renames (`stt_*`, `*_STT`, `START_TTS`/`STOP_TTS`); `audioBuffer` removed
- [x] `session_init.preferences`, `update_preferences`, `preferences_ack`
- [x] Vosk per-language models (`setModel`), display-only
- [x] Session-driven system prompt; Gemini/Groq prompt bugs fixed; Vani tools unregistered
- [x] Client: SessionSetup (language/class/board), language chip, Indic fonts, VAD redemption 12
- [x] Removed Whisper and Piper; `.env.example`, `requirements.txt`, `vocab.txt` updated
- [x] Tests: 99 passing (new: gnaniStt, gnaniTts, sentenceBuffer, session); mock end-to-end turn passes
- [!] Live smoke with a real `GNANI_API_KEY`: `npm run smoke:gnani -- tts "…" hi` and `-- stt file.wav hi`. **User key needed.**
- [!] On-hardware run in a browser with a mic: Hindi turn, Tamil switch, latency logs. **User hardware.**
- [ ] Confirm which script Hinglish TTS (`hi-en`) prefers and adjust its LLM directive

### Phase G1.1 — Live-run fixes, voices, sessions  `[~] code complete, pending live re-test`  (design doc §5.12–5.14)
- [x] Hinglish: single STT locale + codemix (the live API rejected `hi-IN,en-IN`)
- [x] No reconnect storm after a 1008 config rejection; the server's reason reaches the student
- [x] Outbound frame pacing (no bursts); VAD threshold 0.5
- [x] REST STT retry for failed/empty streaming utterances
- [x] Comma-split fix (no 26-request replies); prompt forbids headings/section labels
- [x] Voice catalog + picker with spoken samples (`/api/voices`, `/api/voice-preview`); voice per session; gendered self-reference
- [x] Sessions: saved per conversation, bound to a language, grouped by language, resumable from the start screen or the Sessions panel; per-session context and summary; migration of old turns
- [x] Tests: 116 passing; mock end-to-end of new/switch/resume/preview
- [!] Live re-test with the real key: Hinglish turn, a voice preview per language, resume after a server restart. **User.**

### Phase G1.2 — Second live run fixes + session groups  `[~] code complete, pending live re-test`  (design doc §5.16–5.17)
- [x] Layout: stage no longer spills over header/controls (the "frozen page"); long answers scroll; follow-bottom only when pinned
- [x] Mic stays closed for the whole spoken answer (`tts_state`); mid-utterance gate → `vad_misfire`
- [x] TTS inactivity timeout (12 s) replaces the 15 s total cap that cut long answers
- [x] Individual sessions + student-made groups (create/rename/delete, new session in group, move)
- [x] Content-generated titles (3–5 words), refined at 6/12 turns, user rename wins; old sessions re-titled
- [x] 127 tests; mock e2e of slow-TTS answer, tts_state, titles, groups
- [!] Live re-test: a long answer end to end (all lines spoken, no STT_EMPTY after), scrolling it, titles appearing. **User.**

### Phase G2 — Teacher: chunks, analogies, interaction, memory  `[~] code complete, pending live test`  (design doc §6)
- [x] Teaching-method prompt (`src/prompts/teacher.ts`): intuition → analogy → bridge → one hand-back; responding to answers
- [x] Session memory (`session_context`): topic, gist, lesson plan with chunk status, student state, last offer; summaries migrated
- [x] Global learner profile (`learner_profile`): allowed keys, sensitive filter, memory switch, About-you tab with delete
- [x] Background memory updater: one JSON call per exchange, serial per session; summarizer removed
- [x] Prompt rebuilt from the DB before every answer; history replayed 12 messages (Groq + Gemini)
- [x] Opener: greeting for new sessions, welcome-back recap for resumed ones (not stored)
- [x] Lesson progress card in the sidebar (`session_context` message)
- [x] 155 tests; mock e2e of opener → plan → turn 2 prompt → resume recap
- [!] Live test with the real model (quality of chunking/analogies; consider `openai/gpt-oss-120b`). **User.**
### Phase G3 — Live notes + PDF  `[~] code complete, pending live test`  (design doc §7)
- [x] Notebook model + pure patcher (ids, dedupe, caps, versions)
- [x] Notes agent (background JSON call, student's language, follows the lesson plan); `notebooks` table
- [x] On by default; panel switch; voice "no notes / make notes" via the memory updater; opener mentions notes
- [x] PDF via system Chrome (playwright-core), KaTeX formulas, debounced pre-render, download route
- [x] Docked Notes panel beside the lesson (slide-over on narrow screens), new-note glow, Download PDF
- [x] 176 tests incl. real Chrome renders; mock e2e in Hindi (notes fill, PDF downloads, voice off)
- [!] Live test: notes quality from the real model; PDF of a Tamil/Telugu session. **User.**

---

> Everything below is the **Vani-era tracker**, kept for history. It is superseded by the GuruAI
> phases above. Its Whisper/Piper items no longer apply.

started · `[~]` in progress · `[x]` done · `[!]` blocked · `[-]` cancelled

---

## Milestone 0 — Planning (this phase)

- [x] Clarify STT / frontend / wake-word / memory decisions (round 1)
- [x] Clarify STT design / LLM / echo / intent decisions (round 2)
- [x] Write `.claude/decisions.md` (ADRs D1–D12 + pending)
- [x] Write `.claude/architecture.md` (as-is + target, per feature)
- [x] Write `.claude/plan.md` (master plan, acceptance criteria, phasing, risks)
- [x] Write `.claude/todo.md` (this file)
- [x] Verify docs are consistent with the codebase
- [x] Re-sequence to "Live STT first" per the user (D12)
- [x] **GATE:** user reviewed the plan and approved Phase 1 (Live STT) implementation

---

## Phase 1 — Feature 2: Live STT  `[~] code complete, pending on-hardware validation`  ◀ FIRST
_Depends on: nothing (validated on the current vanilla client). See `plan.md` §5, `architecture.md` §4._

- [x] Add `vosk_server.py` streaming recognizer (download model on user hardware)
- [x] `src/voskProcess.ts` — Node wrapper; fan-out lives in `handleBinaryMessage` +
      existing side effects rather than a new `sttHub.ts` (D13)
- [x] Remove fake `"..."` partials from `faster_whisper_server.py` (was at `len % 20 == 0`)
- [x] Emit real `transcript_partial` (Vosk) to the client — displays on the CURRENT UI's "You" box
- [x] Whisper vocabulary biasing (`initial_prompt`) + configurable term list (`vocab.txt`, `VANI_VOCAB`)
- [x] Add `voskFirstPartialAt` latency marker (`voskFinalAt` dropped — the Vosk final is
      display-only and lands before Whisper's, so it measures nothing actionable)
- [!] Validate CPU contention + final-latency budget (`plan.md` §7 R1/R2) — **user hardware**
- [!] Verify against acceptance criteria (`plan.md` §5.2) — **user hardware**

**Ships without a model:** if `VOSK_MODEL_PATH` is missing, `voskProcess` gives up after 3 fast
exits and logs how to fix it. Whisper → LLM → TTS is unaffected.

---

## Phase 2 — Feature 1: Frontend rebuild  `[~] code complete, pending on-hardware validation`
_Depends on: Phase 1 (live captions to display). See `plan.md` §4, `architecture.md` §3._

- [x] Scaffold the app (Vite + React 19 + TS). Landed in `client/` (the user scaffolded it there),
      **not** `web/` as the plan drafted — see D15. Wired the Node HTTP server to serve `client/dist`.
- [x] `useWsClient` hook — connect/disconnect, session_init handshake, JSON + binary frame demux
- [x] `useVadMic` hook — ported Silero VAD config + 16kHz/512 framing + Float32→Int16; owns the
      MediaStream so Mute stops the tracks outright
- [x] `useAudioPlayback` hook — ported 22050Hz scheduler + pre-buffer + barge-in flush; `speaking`
      driven by the playback clock, not server state
- [x] `useOrbLevel` hook — one amplitude source, selected by turn state. Mic level comes from the
      VAD's own frames (not a second AnalyserNode — see D17); TTS level from a playback AnalyserNode
- [x] `<Orb>` — canvas polar oscilloscope; three traces wave on real amplitude, calm when idle
- [x] `<Captions>` — live user line (Vosk partials from Phase 1) + word-by-word AI reveal (~45ms/word)
- [x] `<Controls>` — Connect/Disconnect, Mute/Unmute (Unmute disabled while disconnected)
- [x] `<LogSidebar>` — slide-out log panel + toggle (Escape to close)
- [x] Remove Porcupine from the client entirely (D4) — grep-verified across `src/`, `index.html`, `dist/`
- [x] Green build: `client` `npm run build` + `npx eslint .` clean; root `npx tsc --noEmit` clean;
      root `npm test` 3 suites / 57 tests pass
- [!] Verify the four observational criteria (`plan.md` §4.2: orb waves both voices, live user
      captions, AI caption/audio sync, Mute = zero frames) — **user hardware**

**Runtime note:** MicVAD still fetches `vad.worklet.bundle.min.js` + `silero_vad_legacy.onnx` from
jsdelivr at load (the `.wasm` runtime is already served locally from `/vad/`). For fully-offline
capture, drop those two files into `client/public/vad/` and set `VAD_ASSET_PATH = '/vad/'` in
`useVadMic.ts`. Behavior is otherwise unchanged. See D16.

---

## Phase 3 — Feature 3a: Persistent context  `[ ] not started`  (parallelizable)
_Depends on: nothing structural; can overlap any phase. See `plan.md` §6.3, `architecture.md` §5.3._

- [ ] Add SQLite dep (`better-sqlite3`; `node:sqlite` fallback); git-ignore `data/`
- [ ] `src/contextStore.ts` — schema (turns, summary, meta); append/load; **no audio**
- [ ] `src/summarizer.ts` — off-hot-path rolling summary (Groq)
- [ ] `session.ts` — hydrate `system + summary + last K turns` on connect
- [ ] Verify cross-restart recall + bounded prompt-prefill (`plan.md` §6.3)

---

## Phase 4 — Feature 3b: Barge-in  `[ ] not started`
_Depends on: Phase 1 (Vosk interims). See `plan.md` §6.2, `architecture.md` §5.2._

- [ ] Relax `micGated()` so mic stays live during `TTS_STREAMING`
- [ ] `src/intentClassifier.ts` (pure) — backchannel | stop | substantive
- [ ] Feed resolved `barge_in_confirmed` / `stop_requested` events to the pure state machine
- [ ] Unify `LLM_STREAMING` + `TTS_STREAMING` barge-in handling
- [ ] Regeneration path: abort LLM + flush TTS + new turn from the interrupting utterance
- [ ] Self-echo mitigation: onset guard + energy threshold (headphones assumption, D7)
- [ ] Verify against acceptance criteria (`plan.md` §6.2)

---

## Deferred (prepare only — no code) ⏸
- [ ] PD1 — Tool integration plan (when greenlit)
- [ ] PD2 — Solari SDK integration — **blocked on the user providing SDK/API details**

---

## Open questions for the user (from `plan.md` §9 / decisions)
- [ ] Provide the uncommon-word/term list for STT biasing — add to `vocab.txt` (seeded with
      placeholders) or `VANI_VOCAB`. Phase 1 shipped with the mechanism, not the terms.
- [ ] Confirm `better-sqlite3` vs `node:sqlite` preference for the context store (Phase 3).
- [ ] Confirm `K` (recent turns kept verbatim) and the summary trigger threshold — or accept
      sensible defaults to be proposed at Phase 3.
- [ ] Solari SDK/API details (blocks PD2).

---

## Notes / blockers
- Sandbox bash has **no outbound network** (proxy 403): model downloads (Vosk/Whisper) and
  live Groq/API tests must be run on the user's hardware — flag such steps here as `[!]` when
  reached (`plan.md` §9 R8).

Let's move forward now Let's skip this barge-in functionality for now.
prepare a .claude files for work on the following features, Don't generate any code for now
1. How it can control my device, how i can connect it to my application such as todoist, notepad, 