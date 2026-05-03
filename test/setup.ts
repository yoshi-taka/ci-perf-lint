import { afterAll } from "bun:test";
import { clearTestCaches } from "./helpers.ts";

afterAll(() => {
  clearTestCaches();
});
