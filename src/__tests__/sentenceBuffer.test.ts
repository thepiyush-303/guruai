// ============================================================
// sentenceBuffer.test.ts — fragmenting LLM tokens for network TTS
// ============================================================

import { SentenceBuffer } from '../sentenceBuffer';

function collect(opts = { firstFlushMs: 40, flushMs: 80 }) {
  const out: string[] = [];
  const buf = new SentenceBuffer((s) => out.push(s), opts);
  return { buf, out };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('SentenceBuffer', () => {
  it('emits a complete sentence at its full stop', () => {
    const { buf, out } = collect();
    buf.append('Gravity pulls every object towards the Earth. Now');
    expect(out).toEqual(['Gravity pulls every object towards the Earth.']);
    buf.reset();
  });

  it('treats the Hindi danda as a sentence end', () => {
    const { buf, out } = collect();
    buf.append('गुरुत्वाकर्षण हर वस्तु को पृथ्वी की ओर खींचता है। अब');
    expect(out).toEqual(['गुरुत्वाकर्षण हर वस्तु को पृथ्वी की ओर खींचता है।']);
    buf.reset();
  });

  it('merges a very short sentence into the next one', () => {
    const { buf, out } = collect();
    buf.append('Yes. That is exactly how a pressure cooker works. ');
    expect(out).toEqual(['Yes. That is exactly how a pressure cooker works.']);
    buf.reset();
  });

  it('splits at a comma only when the clause before it is long', () => {
    const { buf, out } = collect();
    buf.append('First, ');
    expect(out).toEqual([]);
    buf.append('when the train starts moving suddenly all the passengers standing inside lean backwards a little because of inertia, ');
    expect(out.length).toBe(1);
    expect(out[0].endsWith('inertia,')).toBe(true);
    buf.reset();
  });

  it('keeps short clauses of a fast burst together in one sentence', () => {
    const { buf, out } = collect();
    // A whole paragraph arriving at once (fast LLM): commas must not split it.
    buf.append('They take carbon dioxide from the air, water from the soil, and light from the sun, and turn them into glucose and oxygen. Next');
    expect(out).toEqual(['They take carbon dioxide from the air, water from the soil, and light from the sun, and turn them into glucose and oxygen.']);
    buf.reset();
  });

  it('does not split decimals', () => {
    const { buf, out } = collect();
    buf.append('The value of pi is about 3.14 and it never ends');
    expect(out).toEqual([]);
    buf.flush();
    expect(out).toEqual(['The value of pi is about 3.14 and it never ends']);
  });

  it('splits run-on text at a space before the length cap', () => {
    const { buf, out } = collect();
    buf.append('word '.repeat(60));
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) expect(s.length).toBeLessThanOrEqual(220);
    expect(out[0].endsWith('word')).toBe(true);
    buf.reset();
  });

  it('flushes a pending fragment after the first-chunk timeout', async () => {
    const { buf, out } = collect();
    buf.append('Let us understand photosynthesis together');
    await sleep(70);
    expect(out).toEqual(['Let us understand photosynthesis together']);
    buf.reset();
  });

  it('keeps waiting when only a couple of words are pending', async () => {
    const { buf, out } = collect();
    buf.append('So');
    await sleep(120);
    expect(out).toEqual([]);
    buf.flush();
    expect(out).toEqual(['So']);
  });

  it('reset() discards without emitting', async () => {
    const { buf, out } = collect();
    buf.append('This will never be spoken because we reset');
    buf.reset();
    await sleep(70);
    expect(out).toEqual([]);
  });

  it('the tail of a long run-on answer goes out in capped pieces', () => {
    const { buf, out } = collect();
    // A long run-on tail with no sentence end, delivered at once.
    buf.append('aaaa '.repeat(30));
    out.length = 0;
    buf.append('bbbb '.repeat(60));
    buf.flush();
    expect(out.length).toBeGreaterThan(1);
    for (const s of out) expect(s.length).toBeLessThanOrEqual(220);
    expect(out.join(' ').replace(/\s+/g, ' ').trim().split(' ').filter((w) => w === 'bbbb').length).toBe(60);
  });
});
