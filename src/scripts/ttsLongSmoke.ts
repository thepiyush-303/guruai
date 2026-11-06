// ============================================================
// ttsLongSmoke.ts — speak one LONG answer through the real Timbre socket,
// exactly as a lesson does, and report what happened to every sentence.
//
//   npm run smoke:tts-long            (Hinglish, the default voice)
//   npm run smoke:tts-long -- hi Kalpana
//
// For each sentence: whether it was spoken (socket or REST retry) and how
// many seconds of audio reached the "browser". Writes the whole answer to
// data/smoke-tts-long.pcm (raw s16le mono 22050 Hz):
//   ffplay -f s16le -ar 22050 -ac 1 data/smoke-tts-long.pcm
// ============================================================

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import type WebSocket from 'ws';
import { getLanguage } from '../languages';
import { getTts, TTS_SAMPLE_RATE, type TtsRunStats } from '../gnaniTts';
import { SentenceBuffer } from '../sentenceBuffer';
import { sanitizeForTTS } from '../ttsUtils';

const [langId = 'hinglish', voice] = process.argv.slice(2);
const lang = getLanguage(langId);

// A long, realistic answer: quotes, brackets, numbers with units, a question at the end.
const ANSWER = `Fourier transform se aap apni daily life ki problems ko ek naye nazariye se dekh sakte ho.
Socho tum cricket match dekh rahe ho. Match ka scoreboard sirf total runs nahi batata, balki yeh bhi batata hai ki har over me kitne runs bane — har over ka "scorecard" hai.
Bilkul isi tarah, Fourier transform kisi bhi signal ko alag-alag frequencies me tod deta hai, aur batata hai ki har frequency ka contribution kitna hai.
Is "scorecard" ko hum "frequency spectrum" kehte hain (frequency domain representation).
Ab ek example lo: tumhara phone ka speaker ek signal bhejta hai. Agar signal me bass aur treble dono hain, toh speaker unko alag-alag mix karke sound produce karta hai.
Equalizer app me tum dekh sakte ho ki kaunse frequencies zyada hain, jaise bass ya treble, aur unko set kar sakte ho, jisse music clear aur balanced sunai deta hai.
Wi-Fi router bhi frequency bands (2.4 GHz, 5 GHz) me split karte hain, aur Fourier analysis se pata chalta hai ki interference kahan ho raha hai.
Aur ek simple ghar ka example: ek pressure cooker ki seeti! Steam ka pressure wave ek khaas frequency par oscillate karta hai.
Agar koi high-frequency spike dikhe, toh engineer samajh jaata hai ki kuch gadbad hai, aur aapko danger se bachaya ja sakta hai.
To short mein, Fourier transform ek tool hai jo kisi bhi signal ko uski frequencies me todta hai, jisse aap audio, radio, internet, aur safety devices ko better samajh sakte ho.
Kya aap in examples me se kisi ek ke baare me aur detail chahte ho, jaise music, internet ya safety?`;

interface SentenceLog { id: number; text: string; bytes: number }


async function main(): Promise<void> {
  const tts = getTts();
  tts.configure(lang, voice);
  tts.start();

  const sentences: SentenceLog[] = [];
  const pcm: Buffer[] = [];
  const sink = {
    readyState: 1,
    send: (frame: Buffer) => pcm.push(Buffer.from(frame.subarray(4))),
  } as unknown as WebSocket;

  // Record each sentence's audio as it finishes (a private hook — fine for a
  // diagnostic script; the queue is serial, so the job in flight is the one).
  const t = tts as unknown as { inFlight: { id: number; text: string; bytesSent: number } | null; finishJob: () => void };
  const finish = t.finishJob.bind(tts);
  t.finishJob = () => {
    const job = t.inFlight;
    if (job) sentences.push({ id: job.id, text: job.text, bytes: job.bytesSent });
    finish();
  };

  // Split the answer the same way a lesson does (the LLM arrives in a burst).
  const pieces: string[] = [];
  const buf = new SentenceBuffer((s) => {
    const t = sanitizeForTTS(s);
    if (t) pieces.push(t);
  });
  for (const word of ANSWER.split(/(?<=\s)/)) buf.append(word);
  buf.flush();

  console.log(`\n${pieces.length} sentences, ${ANSWER.length} characters, language=${lang.label}, voice=${tts.voice}\n`);

  const done = new Promise<TtsRunStats | undefined>((resolve) => {
    tts.onActivity((active, stats) => {
      if (!active) resolve(stats);
    });
  });

  const started = Date.now();
  for (const p of pieces) tts.synthesize(p, sink);

  const stats = await done;
  const elapsed = (Date.now() - started) / 1000;

  const total = Buffer.concat(pcm);
  const out = path.join('data', 'smoke-tts-long.pcm');
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(out, total);

  console.log('\n#   audio(s)  chars  sentence');
  for (const s of sentences) {
    const secs = s.bytes / 2 / TTS_SAMPLE_RATE;
    // Speech runs at roughly 12–20 characters a second; far less audio means a cut.
    const flag = s.bytes === 0 ? '  <-- NO AUDIO' : secs < s.text.length / 30 ? '  <-- too short for its text' : '';
    console.log(`${String(s.id).padEnd(3)} ${secs.toFixed(1).padStart(7)}  ${String(s.text.length).padStart(5)}  ${s.text.slice(0, 70)}${flag}`);
  }
  console.log(
    `\nspoken ${stats?.spoken ?? '?'}/${pieces.length}, failed ${stats?.failed ?? '?'}; ` +
      `${(total.length / 2 / TTS_SAMPLE_RATE).toFixed(1)} s of audio in ${elapsed.toFixed(1)} s → ${out}`,
  );
  tts.stop();
  process.exit(stats && stats.failed === 0 && stats.spoken === pieces.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
