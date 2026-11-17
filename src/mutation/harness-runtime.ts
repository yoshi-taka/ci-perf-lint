import { expect, mock, onTestFinished, setSystemTime, spyOn } from "bun:test";

export { expect, mock, onTestFinished, setSystemTime, spyOn };

export interface HarnessCase {
  name: string;
  fn: () => unknown;
  before: (() => unknown)[];
  after: (() => unknown)[];
}

export const harnessState = {
  cases: [] as HarnessCase[],
  before: [] as (() => unknown)[],
  after: [] as (() => unknown)[],
  beforeAll: [] as (() => unknown)[],
  afterAll: [] as (() => unknown)[],
  stack: [] as string[],
};

function register(name: string, fn: HarnessCase["fn"]): void {
  harnessState.cases.push({
    name,
    fn,
    before: [...harnessState.before],
    after: [...harnessState.after],
  });
}

export function describe(name: string, fn: () => void): void {
  harnessState.stack.push(name);
  try {
    fn();
  } finally {
    harnessState.stack.pop();
  }
}

export const test = Object.assign((name: string, fn: HarnessCase["fn"]) => register(name, fn), {
  each: (rows: Iterable<unknown>) => (name: string, fn: (...args: unknown[]) => unknown) => {
    for (const row of rows) {
      register(name, () => fn(...(Array.isArray(row) ? row : [row])));
    }
  },
  skip: () => {},
  todo: () => {},
  only: (name: string, fn: HarnessCase["fn"]) => register(name, fn),
});

export function it(name: string, fn: HarnessCase["fn"]): void {
  register(name, fn);
}

export function beforeEach(fn: () => unknown): void {
  harnessState.before.push(fn);
}

export function afterEach(fn: () => unknown): void {
  harnessState.after.push(fn);
}

export function beforeAll(fn: () => unknown): void {
  harnessState.beforeAll.push(fn);
}

export function afterAll(fn: () => unknown): void {
  harnessState.afterAll.push(fn);
}

export function resetHarness(): void {
  harnessState.cases.length = 0;
  harnessState.before.length = 0;
  harnessState.after.length = 0;
  harnessState.beforeAll.length = 0;
  harnessState.afterAll.length = 0;
  harnessState.stack.length = 0;
}
