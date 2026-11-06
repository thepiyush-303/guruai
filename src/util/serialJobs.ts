// ============================================================
// serialJobs.ts — run a background job at most once at a time per key,
// folding triggers that arrive mid-run into one more run afterwards.
//
// Used by the session-memory updater and the notes agent: each exchange
// triggers a job; a burst of exchanges never runs jobs in parallel for the
// same session, and never loses the last one.
// ============================================================

export class SerialJobs {
  private running = new Set<string>();
  private again = new Set<string>();

  constructor(private readonly run: (key: string) => Promise<void>) {}

  /** Resolves when this key's runs (including any folded-in ones) are done. */
  async trigger(key: string): Promise<void> {
    if (this.running.has(key)) {
      this.again.add(key);
      return;
    }
    this.running.add(key);
    try {
      do {
        this.again.delete(key);
        await this.run(key);
      } while (this.again.has(key));
    } finally {
      this.running.delete(key);
    }
  }

  isRunning(key: string): boolean {
    return this.running.has(key);
  }
}
