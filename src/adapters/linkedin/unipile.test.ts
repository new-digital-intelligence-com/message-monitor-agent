import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizeUnipileEvent,
  verifyUnipileSignature,
  type UnipileMessageWebhookPayload,
} from "./unipile.js";

function payload(
  overrides: Partial<UnipileMessageWebhookPayload> = {},
): UnipileMessageWebhookPayload {
  return {
    account_id: "acc_123",
    account_type: "LINKEDIN",
    account_info: { type: "LINKEDIN", feature: "messaging", user_id: "u1" },
    event: "message_received",
    chat_id: "chat_1",
    timestamp: "2026-08-27T10:00:00Z",
    webhook_name: "wh_1",
    message_id: "msg_1",
    message: "Are you open to a call this week?",
    sender: {
      attendee_id: "att_1",
      attendee_name: "Jordan Recruiter",
      attendee_provider_id: "urn:li:person:abc",
    },
    ...overrides,
  };
}

describe("normalizeUnipileEvent", () => {
  it("normalizes a message_received event", () => {
    const msg = normalizeUnipileEvent("li-account-1", payload());
    expect(msg).toMatchObject({
      id: "msg_1",
      accountId: "li-account-1",
      channel: "linkedin",
      from: { name: "Jordan Recruiter", address: "urn:li:person:abc" },
      threadId: "chat_1",
      linkedinType: "message",
    });
  });

  it("ignores non-message_received events", () => {
    expect(normalizeUnipileEvent("li-account-1", payload({ event: "message_read" }))).toBeNull();
    expect(normalizeUnipileEvent("li-account-1", payload({ event: "message_deleted" }))).toBeNull();
  });
});

describe("verifyUnipileSignature", () => {
  const secret = "test-secret";
  const rawBody = JSON.stringify(payload());

  function sign(ts: number, body: string): string {
    const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    return `t=${ts},v0=${sig}`;
  }

  it("accepts a correctly signed payload", () => {
    const header = sign(1755000000, rawBody);
    expect(verifyUnipileSignature(header, rawBody, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const header = sign(1755000000, rawBody);
    expect(verifyUnipileSignature(header, rawBody + "x", secret)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const header = sign(1755000000, rawBody);
    expect(verifyUnipileSignature(header, rawBody, "wrong-secret")).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyUnipileSignature(undefined, rawBody, secret)).toBe(false);
    expect(verifyUnipileSignature("garbage", rawBody, secret)).toBe(false);
  });
});
