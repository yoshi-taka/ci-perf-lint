import { Session } from "node:inspector";

type Post = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/** Precise V8 coverage limited to target code. Keys are stable within one
 * process, so a new key means a block/range was reached for the first time. */
export class Coverage {
  readonly #session = new Session();
  readonly #post: Post;

  constructor() {
    this.#session.connect();
    this.#post = (method, params) =>
      new Promise((resolve, reject) => {
        this.#session.post(method, params, (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        });
      });
  }

  async start(): Promise<void> {
    await this.#post("Profiler.enable");
    await this.#post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
  }

  async take(): Promise<Set<string>> {
    const result = (await this.#post("Profiler.takePreciseCoverage")) as {
      result: {
        url?: string;
        scriptId: string;
        functions: { ranges: { startOffset: number; endOffset: number; count: number }[] }[];
      }[];
    };
    const keys = new Set<string>();
    for (const script of result.result) {
      const url = script.url ?? "";
      if (url.includes("/src/fuzz/") || url.includes("node_modules/")) {
        continue;
      }
      for (const fn of script.functions) {
        for (const range of fn.ranges) {
          if (range.count > 0) {
            keys.add(`${script.scriptId}:${range.startOffset}:${range.endOffset}`);
          }
        }
      }
    }
    return keys;
  }

  async stop(): Promise<void> {
    try {
      await this.#post("Profiler.stopPreciseCoverage");
    } catch {
      // already stopped
    }
    this.#session.disconnect();
  }
}
