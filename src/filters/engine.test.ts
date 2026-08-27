import { describe, expect, it } from "vitest";
import { evaluateCondition } from "./engine.js";
import type { NormalizedMessage } from "../types.js";

function msg(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    id: "1",
    accountId: "acc-1",
    channel: "email",
    receivedAt: "2026-08-27T10:00:00Z",
    from: { address: "alice@example.com", name: "Alice" },
    to: ["team@ndi.com"],
    subject: "Re: pricing question",
    bodyText: "Can we get a discount on the enterprise plan?",
    labels: ["INBOX", "IMPORTANT"],
    ...overrides,
  };
}

describe("evaluateCondition", () => {
  it("matches a simple contains condition", () => {
    const c = { field: "subject" as const, op: "contains" as const, value: "pricing" };
    expect(evaluateCondition(msg(), c)).toBe(true);
  });

  it("is case-insensitive by default", () => {
    const c = { field: "subject" as const, op: "contains" as const, value: "PRICING" };
    expect(evaluateCondition(msg(), c)).toBe(true);
  });

  it("respects caseSensitive: true", () => {
    const c = {
      field: "subject" as const,
      op: "contains" as const,
      value: "PRICING",
      caseSensitive: true,
    };
    expect(evaluateCondition(msg(), c)).toBe(false);
  });

  it("matches from.domain", () => {
    const c = { field: "from.domain" as const, op: "equals" as const, value: "example.com" };
    expect(evaluateCondition(msg(), c)).toBe(true);
  });

  it("matches any element of an array field (to)", () => {
    const c = { field: "to" as const, op: "contains" as const, value: "ndi.com" };
    expect(evaluateCondition(msg(), c)).toBe(true);
  });

  it("supports regex via matches", () => {
    const c = { field: "body" as const, op: "matches" as const, pattern: "discount|refund" };
    expect(evaluateCondition(msg(), c)).toBe(true);
  });

  it("supports in against a set of values", () => {
    const c = { field: "channel" as const, op: "in" as const, values: ["email", "linkedin"] };
    expect(evaluateCondition(msg(), c)).toBe(true);
  });

  it("combines conditions with all", () => {
    const c = {
      all: [
        { field: "from.domain" as const, op: "equals" as const, value: "example.com" },
        { field: "subject" as const, op: "contains" as const, value: "pricing" },
      ],
    };
    expect(evaluateCondition(msg(), c)).toBe(true);
    expect(evaluateCondition(msg({ subject: "unrelated" }), c)).toBe(false);
  });

  it("combines conditions with any", () => {
    const c = {
      any: [
        { field: "label" as const, op: "equals" as const, value: "SPAM" },
        { field: "label" as const, op: "equals" as const, value: "IMPORTANT" },
      ],
    };
    expect(evaluateCondition(msg(), c)).toBe(true);
  });

  it("negates with not", () => {
    const c = { not: { field: "label" as const, op: "equals" as const, value: "SPAM" } };
    expect(evaluateCondition(msg(), c)).toBe(true);
    expect(evaluateCondition(msg({ labels: ["SPAM"] }), c)).toBe(false);
  });

  it("returns false when the field has no values to check", () => {
    const c = { field: "from.name" as const, op: "contains" as const, value: "a" };
    expect(evaluateCondition(msg({ from: { address: "bob@example.com" } }), c)).toBe(false);
  });

  it("nests all/any/not arbitrarily deep", () => {
    const c = {
      all: [
        {
          any: [
            { field: "channel" as const, op: "equals" as const, value: "linkedin" },
            { field: "from.domain" as const, op: "equals" as const, value: "example.com" },
          ],
        },
        { not: { field: "label" as const, op: "equals" as const, value: "SPAM" } },
      ],
    };
    expect(evaluateCondition(msg(), c)).toBe(true);
  });
});
