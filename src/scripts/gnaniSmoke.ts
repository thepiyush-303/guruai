// ============================================================
// gnaniSmoke.ts — check the Gnani credentials and models against the
// live API, outside the full app.
//
//   npm run smoke:gnani -- tts "नमस्ते, आज हम प्रकाश संश्लेषण पढ़ेंगे।" hi
//       → writes data/smoke-tts.pcm (raw s16le mono 22050 Hz) and reports its size
//         play it:  ffplay -f s16le -ar 22050 -ac 1 data/smoke-tts.pcm
//
//   npm run smoke:gnani -- stt path/to/speech.wav hi
//       → streams 16 kHz mono 16-bit audio (WAV or raw PCM) and prints the transcript
//         make one: ffmpeg -i in.m4a -ar 16000 -ac 1 -f s16le speech.pcm
// ============================================================

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { getLanguage } from '../languages';
import { getStt, STT_FRAME_BYTES } from '../gnaniStt';
import { getTts } from '../gnaniTts';
import { stripWavHeader } from '../ttsFraming';
import type WebSocket from 'ws';

const [mode, arg, langId = 'en'] = process.argv.slice(2);
const lang = getLanguage(langId);

function usage(): never {
  console.error('usage: gnaniSmoke tts "<text>" [lang]  |  gnaniSmoke stt <file.wav|file.pcm> [lang]');
  process.exit(2);
}

async function smokeTts(text: string): Promise<void> {
  const tts = getTts();
  tts.configure(lang);
  const chunks: Buffer[] = [];
  // A stand-in for the browser socket: collect the framed audio.
  const sink = {
    readyState: 1,
    send: (frame: Buffer) => chunks.push(frame.subarray(4)),
  } as unknown as WebSocket;

  const started = Date.now();
  tts.start();
  tts.beginTurn();
  tts.synthesize(text, sink);

  // Done when no audio has arrived for 1.5 s after the first chunk (or 15 s total).
  let last = 0;
  while (Date.now() - started < 15_000) {
    await new Promise((r) => setTimeout(r, 100));
    const n = chunks.length;
    if (n > 0 && n === last) {
      await new Promise((r) => setTimeout(r, 1500));
      if (chunks.length === n) break;
    }
    last = chunks.length;
  }
  tts.stop();

  const pcm = Buffer.concat(chunks);
  fs.mkdirSync('data', { recursive: true });
  const out = path.join('data', 'smoke-tts.pcm');
  fs.writeFileSync(out, pcm);
  const seconds = pcm.length / 2 / 22050;
  console.log(`\nTTS ${lang.label}: ${pcm.length} bytes (${seconds.toFixed(2)} s of audio), even-length=${pcm.length % 2 === 0}`);
  console.log(`saved ${out} — play: ffplay -f s16le -ar 22050 -ac 1 ${out}`);
  if (pcm.length === 0) process.exitCode = 1;
}

async function smokeStt(file: string): Promise<void> {
  const pcm = stripWavHeader(fs.readFileSync(file));
  const stt = getStt();
  stt.configure(lang);

  const done = new Promise<void>((resolve) => {
    stt.onEvent((ev) => {
      if (ev.type === 'final') {
        console.log(`\nSTT ${lang.label}: "${ev.text}"`);
        console.log(`commit→final ${ev.duration_ms}ms, gnani latency ${ev.gnani_latency_ms ?? '?'}ms, detected ${ev.detected_language ?? '-'}`);
        if (!ev.text) process.exitCode = 1;
      } else {
        console.error(`\nSTT error ${ev.code}: ${ev.msg}`);
        process.exitCode = 1;
      }
      resolve();
    });
  });

  stt.beginUtterance();
  // Real-time cadence, as the API requires: one 32 ms frame every 32 ms.
  for (let off = 0; off < pcm.length; off += STT_FRAME_BYTES) {
    stt.writeChunk(pcm.subarray(off, off + STT_FRAME_BYTES));
    await new Promise((r) => setTimeout(r, 32));
  }
  stt.commit();
  await done;
  stt.stop();
}

(async () => {
  if (!process.env.GNANI_API_KEY) {
    console.error('GNANI_API_KEY is not set (add it to .env)');
    process.exit(2);
  }
  if (mode === 'tts' && arg) await smokeTts(arg);
  else if (mode === 'stt' && arg) await smokeStt(arg);
  else usage();
  setTimeout(() => process.exit(), 200);
})();
