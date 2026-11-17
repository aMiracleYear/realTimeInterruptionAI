import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { connectRealtime, realtimeSessionConfig } from "../server/realtime";
test("native audio VAD never owns the semantic decision; both autonomous flags are disabled", () => {
  const config = realtimeSessionConfig();
  assert.equal(config.audio.input.turn_detection.create_response, false);
  assert.equal(config.audio.input.turn_detection.interrupt_response, false);
});
test("SDP proxy keeps the long-lived key on the server and hides upstream error bodies (mocked provider)", async () => {
  const oldKey = process.env.OPENAI_API_KEY,
    oldFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "unit-test-key";
  const calls: unknown[] = [];
  let status = 200;
  const response = {
    status: (n: number) => {
      status = n;
      return response;
    },
    json: (body: unknown) => {
      calls.push(body);
      return response;
    },
    set: () => response,
    type: () => response,
    send: (body: unknown) => {
      calls.push(body);
      return response;
    },
    sendStatus: (n: number) => {
      status = n;
      return response;
    },
  };
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/realtime/calls");
      const form = options?.body as FormData;
      assert.equal(form.get("sdp"), "v=0\r\n");
      const config = JSON.parse(String(form.get("session")));
      assert.equal(config.audio.input.turn_detection.create_response, false);
      return new Response("v=0\r\nanswer");
    };
    await connectRealtime(
      {
        ip: "test-ok",
        headers: { origin: "http://localhost:5173", host: "localhost:5173" },
        body: { sdp: "v=0\r\n" },
      } as Request,
      response as unknown as Response,
    );
    assert.equal(status, 200);
    assert.equal(calls.at(-1), "v=0\r\nanswer");
    globalThis.fetch = async () =>
      new Response("private upstream detail", { status: 401 });
    await connectRealtime(
      { ip: "test-fail", headers: {}, body: { sdp: "v=0\r\n" } } as Request,
      response as unknown as Response,
    );
    assert.equal(status, 502);
    assert.ok(!JSON.stringify(calls).includes("private upstream detail"));
    assert.ok(!JSON.stringify(calls).includes("unit-test-key"));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});
