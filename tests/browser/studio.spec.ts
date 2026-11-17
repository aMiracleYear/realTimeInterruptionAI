import { test, expect } from "@playwright/test";
test("text interview, hint attribution, thinking override, feedback, review and JSON export", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByText("Coach connected", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Let’s start practicing" }).click();
  await page.getByRole("button", { name: "Give me a hint" }).click();
  await expect(
    page.getByRole("heading", { name: /Start from the power/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Helpful", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Your answer" })
    .fill(
      "First I would calculate the torque from power and speed to determine the bending loads at the supports.",
    );
  await page.getByRole("button", { name: "Send answer" }).click();
  await expect(
    page.getByText("Assisted signal", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "+30s to think" }).click();
  await expect(page.getByText(/THINKING SPACE/)).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Take your time. You have room to think.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByText("SESSION PAUSED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /A centrifugal pump is vibrating/ }),
  ).toBeVisible();
  await expect(page.getByText("THINKING SPACE", { exact: false })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.getByRole("button", { name: "End & review" }).click();
  await expect(
    page.getByRole("heading", { name: "Your practice, in perspective." }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export session" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream!) content += chunk.toString();
  const data = JSON.parse(content);
  expect(data.session.status).toBe("completed");
  expect(data.session.evidence[0].assisted).toBe(true);
  expect(data.session.decisions[0].feedback).toBe("helpful");
  expect(data.session.segments).toHaveLength(1);
  expect(errors).toEqual([]);
});
test("guided drift replay actually triggers a redirect and records its rationale", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /An answer goes off track/ }).click();
  await expect(page.getByText("Guided replay", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Let’s bring that back/ }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /Coach notes/ }).click();
  await expect(
    page
      .locator(".note-row")
      .getByText(
        "Two stable updates show drift or repetition without new rubric evidence.",
        { exact: true },
      ),
  ).toBeVisible();
});
test("guided long pause offers optional support and productive reasoning has no premature cuts", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /A longer moment of silence/ })
    .click();
  await expect(
    page.getByRole("heading", { name: /Would you like a small hint/ }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.getByRole("button", { name: "End & review" }).click();
  await page.getByRole("button", { name: "Live studio", exact: true }).click();
  await page.getByRole("button", { name: /Good thinking takes time/ }).click();
  await expect(
    page.getByRole("heading", { name: /Shall we move on/ }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: /Coach notes/ }).click();
  await expect(page.locator(".note-row")).toHaveCount(1);
  await expect(
    page
      .locator(".note-row")
      .getByText("All rubric areas have supporting signals.", { exact: true }),
  ).toBeVisible();
});
test("mobile layout, empty review and approach navigation remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Session review", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Your next step starts with one answer.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Our approach", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /A pause is not proof/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Live studio", exact: true }).click();
  await page.getByRole("button", { name: "Let’s start practicing" }).click();
  await expect(
    page.getByRole("textbox", { name: "Your answer" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("speech interim text stays unscored; finalized recognition reaches the evidence ledger", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class MockRecognition {
      continuous = true;
      interimResults = true;
      lang = "en-US";
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        (
          window as unknown as { mockRecognition: MockRecognition }
        ).mockRecognition = this;
        this.onstart?.();
      }
      abort() {
        this.onend?.();
      }
      stop() {
        this.onend?.();
      }
    }
    (
      window as unknown as { SpeechRecognition: typeof MockRecognition }
    ).SpeechRecognition = MockRecognition;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Let’s start practicing" }).click();
  await page.getByRole("button", { name: "Use microphone" }).click();
  await page
    .getByRole("button", { name: "I agree to use browser speech recognition" })
    .click();
  await page.getByRole("button", { name: "Start microphone" }).click();
  const text =
    "First I would calculate torque from power and speed to establish the operating loads.";
  await page.evaluate((text) => {
    (
      window as unknown as {
        mockRecognition: { onresult: (e: unknown) => void };
      }
    ).mockRecognition.onresult({
      resultIndex: 0,
      results: [{ isFinal: false, 0: { transcript: text, confidence: 0.9 } }],
    });
  }, text);
  await expect(page.locator(".interim")).toContainText(text);
  await expect(
    page.getByText("Evidence captured", { exact: true }),
  ).toHaveCount(0);
  await page.evaluate((text) => {
    (
      window as unknown as {
        mockRecognition: { onresult: (e: unknown) => void };
      }
    ).mockRecognition.onresult({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: text, confidence: 0.9 } }],
    });
  }, text);
  await expect(page.locator(".transcript-line")).toHaveCount(1);
  await expect(
    page.getByText("Evidence captured", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByText("Microphone is off", { exact: true }),
  ).toBeVisible();
});
