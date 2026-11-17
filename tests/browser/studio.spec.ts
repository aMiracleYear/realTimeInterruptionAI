import { test, expect } from "@playwright/test";
const answer =
  "First I would calculate the torque from power and speed to determine the bending loads at the supports.";
test("text practice automatically advances on give-up, technical error, and sustained drift; exports decisions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Prefer typing? Try text practice" })
    .click();
  const input = page.getByRole("textbox", { name: "Your answer" });
  await input.fill("I don't know");
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(
    page.getByRole("heading", { name: /A centrifugal pump/ }),
  ).toBeVisible();
  await input.fill("Cavitation is caused by high suction pressure.");
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(
    page.getByRole("heading", { name: /Tell me about an engineering project/ }),
  ).toBeVisible();
  await input.fill(
    "I like watching movies and I spent the weekend planning a holiday with friends.",
  );
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(
    page.getByRole("heading", { name: /Tell me about an engineering project/ }),
  ).toBeVisible();
  await input.fill(
    "The beach was beautiful and the food and music kept everyone entertained throughout the holiday.",
  );
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(
    page.getByText("INTERVIEW COMPLETE", { exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const stream = await (await downloadPromise).createReadStream();
  let data = "";
  for await (const chunk of stream!) data += chunk.toString();
  const report = JSON.parse(data);
  expect(
    report.session.decisions.map((d: { reasonCode: string }) => d.reasonCode),
  ).toEqual(["give_up", "incorrect_low_recovery", "drift_low_recovery"]);
  expect(report.session.status).toBe("completed");
  expect(report.session.evidence).toHaveLength(0);
  expect(errors).toEqual([]);
});
test("uncertainty, self-correction and productive reasoning retain the floor; rubric and hint attribution work", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Prefer typing? Try text practice" })
    .click();
  const input = page.getByRole("textbox", { name: "Your answer" });
  await page.getByRole("button", { name: "A small hint" }).click();
  await input.fill(
    "I don't know the exact dimensions, but I would first calculate torque from the power and speed.",
  );
  await page.getByRole("button", { name: "Send answer" }).click();
  await input.fill(
    "Fatigue is irrelevant. Actually that is wrong; I need to check fatigue under fluctuating loading.",
  );
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(
    page.getByRole("heading", { name: /How would you design a shaft/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open interruption rubric" }).click();
  await expect(
    page.getByText(
      "These are uncalibrated estimates, not measured probabilities of ability.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Candidate is explicitly correcting their reasoning."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: "Open transcript" }).click();
  await expect(page.getByText("Assisted · Q1", { exact: true })).toBeVisible();
});
test("browser voice speaks first, automatically listens, handles interim error mid-answer and reopens the mic on the next question", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class FakeUtterance {
      text: string;
      rate = 1;
      onstart?: () => void;
      onend?: () => void;
      onerror?: () => void;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: FakeUtterance,
    });
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        cancel() {},
        speak(u: FakeUtterance) {
          u.onstart?.();
          queueMicrotask(() => u.onend?.());
        },
      },
    });
    class FakeRecognition {
      continuous = true;
      interimResults = true;
      lang = "en-US";
      onstart?: () => void;
      onend?: () => void;
      onresult?: (e: unknown) => void;
      start() {
        (window as unknown as { recognition: FakeRecognition }).recognition =
          this;
        this.onstart?.();
      }
      abort() {
        this.onend?.();
      }
    }
    (
      window as unknown as { SpeechRecognition: typeof FakeRecognition }
    ).SpeechRecognition = FakeRecognition;
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start voice interview", exact: true })
    .click();
  await expect(
    page.getByText("LISTENING TO YOUR THINKING", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (
      window as unknown as { recognition: { onresult: (e: unknown) => void } }
    ).recognition.onresult({
      resultIndex: 0,
      results: [
        {
          isFinal: false,
          0: {
            transcript:
              "Fatigue is irrelevant to this design because only static stress matters.",
            confidence: 0.95,
          },
        },
      ],
    });
  });
  // A stable partial must trigger before the browser ever emits a finalized utterance.
  await expect(
    page.getByRole("heading", { name: /A centrifugal pump/ }),
  ).toBeVisible({ timeout: 5000 });
  await expect(
    page.getByText("LISTENING TO YOUR THINKING", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (
      window as unknown as { recognition: { onresult: (e: unknown) => void } }
    ).recognition.onresult({
      resultIndex: 0,
      results: [
        { isFinal: true, 0: { transcript: "I don't know", confidence: 0 } },
      ],
    });
  });
  await expect(
    page.getByRole("heading", { name: /Tell me about an engineering project/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mute microphone", exact: true })
    .click();
  await expect(
    page.getByText("MICROPHONE MUTED", { exact: true }),
  ).toBeVisible();
});
test("mobile voice-first interface fits and session can restart after ending", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Prefer typing? Try text practice" })
    .click();
  await page.getByRole("textbox", { name: "Your answer" }).fill(answer);
  await page.getByRole("button", { name: "Send answer" }).click();
  await page.getByRole("button", { name: "End interview" }).click();
  await expect(
    page.getByText("INTERVIEW COMPLETE", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Prefer typing? Try text practice" })
    .click();
  await expect(
    page.getByRole("heading", { name: /How would you design a shaft/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("native transport keeps audio input open, ignores backchannels, and cancels/truncates a real floor request (mocked WebRTC)", async ({
  page,
}) => {
  await page.routeWebSocket("**/ws", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      const event = JSON.parse(String(raw));
      if (event.type === "hello") event.realtimeConfigured = true;
      socket.send(JSON.stringify(event));
    });
  });
  await page.route("**/api/realtime/connect", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/sdp",
      body: "v=0\r\nmock-answer",
    }),
  );
  await page.addInitScript(() => {
    const test = {
      events: [] as Record<string, unknown>[],
      track: { enabled: true, stop() {} },
      channel: null as unknown as { onmessage: (e: { data: string }) => void },
    };
    (window as unknown as { rtcTest: typeof test }).rtcTest = test;
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async (constraints: {
          audio: { echoCancellation: boolean };
        }) => {
          if (!constraints.audio.echoCancellation)
            throw new Error("AEC was not requested");
          return {
            getTracks: () => [test.track],
            getAudioTracks: () => [test.track],
          };
        },
      },
    });
    class FakeRecognition {
      continuous = true;
      interimResults = true;
      lang = "en-US";
      onstart?: () => void;
      onend?: () => void;
      start() {
        this.onstart?.();
      }
      abort() {
        this.onend?.();
      }
    }
    (
      window as unknown as { SpeechRecognition: typeof FakeRecognition }
    ).SpeechRecognition = FakeRecognition;
    class FakePeer {
      connectionState = "connected";
      ontrack = null;
      onconnectionstatechange = null;
      channel = {
        readyState: "connecting",
        onopen: null as (() => void) | null,
        onmessage: null as ((e: { data: string }) => void) | null,
        close() {},
        send(raw: string) {
          const event = JSON.parse(raw);
          test.events.push(event);
          if (event.type === "response.create") {
            const id = `response-${test.events.filter((e) => e.type === "response.create").length}`;
            queueMicrotask(() => {
              for (const frame of [
                {
                  type: "response.created",
                  response: { id, metadata: event.response.metadata },
                },
                {
                  type: "response.output_item.added",
                  response_id: id,
                  item: { id: `item-${id}`, role: "assistant" },
                },
                { type: "output_audio_buffer.started", response_id: id },
              ])
                test.channel.onmessage({ data: JSON.stringify(frame) });
            });
          }
        },
      };
      addTrack() {}
      createDataChannel() {
        test.channel = this.channel as typeof test.channel;
        return this.channel;
      }
      async createOffer() {
        return { type: "offer", sdp: "v=0\r\nmock-offer" };
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.channel.readyState = "open";
        this.channel.onopen?.();
      }
      close() {
        this.connectionState = "closed";
      }
    }
    (
      window as unknown as { RTCPeerConnection: typeof FakePeer }
    ).RTCPeerConnection = FakePeer;
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start voice interview", exact: true })
    .click();
  await expect(
    page.getByText("CADENCE IS SPEAKING", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const t = (
      window as unknown as {
        rtcTest: { channel: { onmessage: (e: { data: string }) => void } };
      }
    ).rtcTest;
    t.channel.onmessage({
      data: JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "backchannel-1",
        transcript: "yeah",
      }),
    });
  });
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { rtcTest: { events: { type: string }[] } }
        ).rtcTest.events.filter((e) => e.type === "response.cancel").length,
    ),
  ).toBe(0);
  await page.evaluate(() => {
    const t = (
      window as unknown as {
        rtcTest: { channel: { onmessage: (e: { data: string }) => void } };
      }
    ).rtcTest;
    t.channel.onmessage({
      data: JSON.stringify({
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "barge-1",
        delta: "wait can I clarify something",
      }),
    });
  });
  await expect(
    page.getByText("LISTENING TO YOUR THINKING", { exact: true }),
  ).toBeVisible();
  const events = await page.evaluate(
    () =>
      (
        window as unknown as {
          rtcTest: { events: { type: string }[]; track: { enabled: boolean } };
        }
      ).rtcTest,
  );
  expect(events.events.slice(-3).map((e) => e.type)).toEqual([
    "response.cancel",
    "output_audio_buffer.clear",
    "conversation.item.truncate",
  ]);
  expect(events.track.enabled).toBe(true);
});
test("a developing partial “I don’t know … but” is not mistaken for a completed give-up", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class U {
      text: string;
      onstart?: () => void;
      onend?: () => void;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: U });
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        cancel() {},
        speak(u: U) {
          u.onstart?.();
          queueMicrotask(() => u.onend?.());
        },
      },
    });
    class R {
      continuous = true;
      interimResults = true;
      lang = "en-US";
      onstart?: () => void;
      onend?: () => void;
      onresult?: (e: unknown) => void;
      start() {
        (window as unknown as { r: R }).r = this;
        this.onstart?.();
      }
      abort() {
        this.onend?.();
      }
    }
    (window as unknown as { SpeechRecognition: typeof R }).SpeechRecognition =
      R;
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start voice interview", exact: true })
    .click();
  await expect(
    page.getByText("LISTENING TO YOUR THINKING", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const r = (window as unknown as { r: { onresult: (e: unknown) => void } })
      .r;
    r.onresult({
      resultIndex: 0,
      results: [
        { isFinal: false, 0: { transcript: "I don't know", confidence: 0.9 } },
      ],
    });
    r.onresult({
      resultIndex: 0,
      results: [
        {
          isFinal: false,
          0: {
            transcript:
              "I don't know the exact dimensions but I can calculate torque from the power and speed",
            confidence: 0.9,
          },
        },
      ],
    });
  });
  await page.getByRole("button", { name: "Open interruption rubric" }).click();
  await expect(
    page.getByText("provisional speech", { exact: false }),
  ).toBeVisible({ timeout: 5000 });
  await expect(
    page.getByText("No intervention yet.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(
    page.getByRole("heading", { name: /How would you design a shaft/ }),
  ).toBeVisible();
});
