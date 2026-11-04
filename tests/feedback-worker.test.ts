// @vitest-environment node
import {afterEach, describe, expect, it, vi} from "vitest";
import feedbackWorker from "../feedback-worker/worker.js";

const env = () => ({
  RESEND_API_KEY: "test-api-key",
  FEEDBACK_TO: "owner@example.com",
  FEEDBACK_FROM: "Context Translator <onboarding@resend.dev>",
  FEEDBACK_RATE_LIMITER: {limit: vi.fn().mockResolvedValue({success: true})}
});

function postFeedback(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("https://feedback.example.workers.dev/", {
    method: "POST",
    headers: {"CF-Connecting-IP": "203.0.113.8"},
    body: form
  });
}

describe("feedback Worker", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("puts arbitrary contact text before the message and escapes HTML", async () => {
    const sendEmail = vi.fn().mockResolvedValue(new Response("{}", {status: 200}));
    vi.stubGlobal("fetch", sendEmail);
    const bindings = env();
    const response = await feedbackWorker.fetch(postFeedback({
      message: "Please help <me>.",
      contact: "@helper <profile>",
      contactLabel: "Контактная информация"
    }), bindings);

    expect(response.status).toBe(200);
    expect(bindings.FEEDBACK_RATE_LIMITER.limit).toHaveBeenCalledWith({key: "203.0.113.8"});
    const [, request] = sendEmail.mock.calls[0] as unknown as [string, {body: string}];
    const payload = JSON.parse(request.body);
    expect(payload.text).toBe("Контактная информация: @helper <profile>\n\nPlease help <me>.");
    expect(payload.html).toContain("<strong>Контактная информация:</strong> @helper &lt;profile&gt;");
    expect(payload.html).toContain("<p>Please help &lt;me&gt;.</p>");
    expect(payload).not.toHaveProperty("reply_to");
  });

  it("uses an email contact as Reply-To", async () => {
    const sendEmail = vi.fn().mockResolvedValue(new Response("{}", {status: 200}));
    vi.stubGlobal("fetch", sendEmail);
    await feedbackWorker.fetch(postFeedback({message: "Hello", contact: "person@example.com"}), env());

    const [, request] = sendEmail.mock.calls[0] as unknown as [string, {body: string}];
    expect(JSON.parse(request.body).reply_to).toBe("person@example.com");
  });

  it("returns 429 without sending when the rate limit is exceeded", async () => {
    const sendEmail = vi.fn();
    vi.stubGlobal("fetch", sendEmail);
    const bindings = env();
    bindings.FEEDBACK_RATE_LIMITER.limit.mockResolvedValue({success: false});

    const response = await feedbackWorker.fetch(postFeedback({message: "Hello"}), bindings);

    expect(response.status).toBe(429);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
