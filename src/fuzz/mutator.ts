export const MAX_INPUT_BYTES = 4096;

const DICTIONARY = [
  "on:",
  "jobs:",
  "steps:",
  "runs-on:",
  "uses:",
  "with:",
  "name:",
  "true",
  "false",
  "null",
  "{{",
  "}}",
  "\n  ",
  "\n- ",
  ": ",
  " |",
  "...",
];

export class Rng {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    let x = this.#state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.#state = x >>> 0;
    return this.#state;
  }

  int(maxExclusive: number): number {
    return this.next() % Math.max(1, maxExclusive);
  }
}

export function mutate(
  input: Buffer,
  rng: Rng,
  corpus: readonly Buffer[],
  maxLength = MAX_INPUT_BYTES,
): Buffer {
  let data = Buffer.from(input);
  const operations = 1 + rng.int(6);
  for (let step = 0; step < operations; step += 1) {
    const choice = rng.int(8);
    const length = data.length;
    if (choice === 0 && length > 0) {
      const index = rng.int(length);
      data[index] = (data[index] ?? 0) ^ (1 << rng.int(8));
    } else if (choice === 1 && length > 0) {
      data[rng.int(length)] = rng.int(256);
    } else if (choice === 2 && length < maxLength) {
      const index = rng.int(length + 1);
      const byte = rng.int(256);
      data = Buffer.concat([data.subarray(0, index), Buffer.from([byte]), data.subarray(index)]);
    } else if (choice === 3 && length > 1) {
      const start = rng.int(length - 1);
      const count = 1 + rng.int(Math.min(length - start, 16));
      data = Buffer.concat([data.subarray(0, start), data.subarray(start + count)]);
    } else if (choice === 4 && length > 0 && length < maxLength) {
      const start = rng.int(length);
      const count = 1 + rng.int(Math.min(length - start, 32));
      const insertAt = rng.int(length + 1);
      const slice = data.subarray(start, start + count);
      data = Buffer.concat([data.subarray(0, insertAt), slice, data.subarray(insertAt)]);
    } else if (choice === 5 && corpus.length > 0 && length < maxLength) {
      const source = corpus[rng.int(corpus.length)]!;
      if (source.length > 0) {
        const start = rng.int(source.length);
        const count = 1 + rng.int(Math.min(source.length - start, 64));
        const insertAt = rng.int(length + 1);
        data = Buffer.concat([
          data.subarray(0, insertAt),
          source.subarray(start, start + count),
          data.subarray(insertAt),
        ]);
      }
    } else if (choice === 6 && length < maxLength) {
      const token = Buffer.from(DICTIONARY[rng.int(DICTIONARY.length)]!, "utf8");
      if (length + token.length <= maxLength) {
        const insertAt = rng.int(length + 1);
        data = Buffer.concat([data.subarray(0, insertAt), token, data.subarray(insertAt)]);
      }
    } else if (choice === 7 && length > 8) {
      data = data.subarray(0, 1 + rng.int(length - 1));
    }
    if (data.length > maxLength) {
      data = data.subarray(0, maxLength);
    }
  }
  if (data.length === 0) {
    data = Buffer.from(DICTIONARY[rng.int(DICTIONARY.length)]!, "utf8");
  }
  return Buffer.from(data);
}
