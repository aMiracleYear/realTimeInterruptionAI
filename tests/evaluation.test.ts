import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreWindows, evaluate } from "../server/evaluate";
test("window scoring is one-to-one and counts duplicates, missed windows and wrong actions", () => {
  assert.deepEqual(
    scoreWindows(
      [
        { at: 20, action: "PROMPT" },
        { at: 21, action: "PROMPT" },
        { at: 40, action: "REDIRECT" },
      ],
      [
        { start: 18, end: 22, actions: ["PROMPT"] },
        { start: 35, end: 45, actions: ["PROBE"] },
      ],
    ),
    { tp: 1, fp: 2, fn: 1 },
  );
});
test("synthetic trace regression runs every selected trace and reports its count", () => {
  const results = evaluate(
    new URL("./fixtures/timing.json", import.meta.url).pathname,
  );
  assert.equal(results.length, 3);
  assert.equal(results.find((r) => r.policy === "adaptive")?.traces, 6);
  assert.equal(results.find((r) => r.policy === "adaptive")?.fp, 0);
  assert.equal(results.find((r) => r.policy === "adaptive")?.fn, 0);
});
