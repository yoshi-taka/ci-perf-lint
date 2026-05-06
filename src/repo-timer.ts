function timingsEnabled(): boolean {
  return process.env.CI_PERF_LINT_TIMINGS === "1";
}

export class PhaseTimer {
  readonly #prefix: string;
  readonly #startedAt: number;
  #lastAt: number;
  readonly #entries: string[] = [];

  constructor(prefix: string) {
    this.#prefix = prefix;
    this.#startedAt = performance.now();
    this.#lastAt = this.#startedAt;
  }

  mark(label: string): void {
    if (!timingsEnabled()) {
      return;
    }

    const now = performance.now();
    this.#entries.push(`${label}=${(now - this.#lastAt).toFixed(1)}ms`);
    this.#lastAt = now;
  }

  flush(): void {
    if (!timingsEnabled()) {
      return;
    }

    const total = (performance.now() - this.#startedAt).toFixed(1);
    process.stderr.write(`[timing] ${this.#prefix} total=${total}ms ${this.#entries.join(" ")}\n`);
  }
}
