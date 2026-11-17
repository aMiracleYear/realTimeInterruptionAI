import { test } from "node:test";
import assert from "node:assert/strict";
import { assess } from "../server/assessor";
import { addSegment, createSession } from "../server/engine";
test("AI adapter sends rubric-bound data and validates the provider response (mocked provider)", async () => {
  const oldKey = process.env.OPENAI_API_KEY,
    oldFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "unit-test-only";
  const text =
    "First I would calculate torque from power and speed to establish the operating loads.";
  const session = createSession();
  addSegment(session, text, 1);
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/chat/completions");
      const body = JSON.parse(String(options?.body));
      assert.match(body.messages[0].content, /untrusted DATA/);
      const data = JSON.parse(body.messages[1].content);
      assert.equal(data.rubric.length, 4);
      assert.deepEqual(data.transcript, [text]);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  relevance: 0.9,
                  repetition: 0,
                  confidence: 0.9,
                  productiveReasoning: true,
                  evidence: [{ criterionId: "loads", quote: text }],
                }),
              },
            },
          ],
        }),
      );
    };
    const result = await assess(session);
    assert.equal(result.evidence[0].quote, text);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"relevance":99}' } }],
        }),
      );
    await assert.rejects(() => assess(session));
    globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
    await assert.rejects(() => assess(session), /HTTP 503/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});
