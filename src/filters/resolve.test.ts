import { describe, expect, it } from "vitest";
import { resolveMessage } from "./resolve.js";
import type { AccountConfig, NormalizedMessage } from "../types.js";

const message: NormalizedMessage = {
  id: "1",
  accountId: "acc-1",
  channel: "email",
  receivedAt: "2026-08-27T10:00:00Z",
  from: { address: "alice@bigclient.com" },
  subject: "Urgent: contract renewal",
};

function account(overrides: Partial<AccountConfig> = {}): AccountConfig {
  return {
    id: "acc-1",
    label: "Sales inbox",
    channel: "email",
    provider: "imap",
    host: "imap.example.com",
    port: 993,
    secure: true,
    userEnv: "X",
    passwordEnv: "Y",
    rules: [],
    ...overrides,
  } as AccountConfig;
}

describe("resolveMessage", () => {
  it("routes to the matched rule's notify targets", () => {
    const acc = account({
      rules: [
        {
          id: "urgent-from-bigclient",
          match: {
            all: [
              { field: "from.domain", op: "equals", value: "bigclient.com" },
              { field: "subject", op: "contains", value: "urgent" },
            ],
          },
          notify: [{ type: "slack", channel: "#sales-urgent" }],
        },
      ],
    });

    const result = resolveMessage(message, acc);
    expect(result.matchedRules).toHaveLength(1);
    expect(result.targets).toEqual([{ type: "slack", channel: "#sales-urgent" }]);
  });

  it("dedupes identical targets across multiple matched rules", () => {
    const target = { type: "email" as const, to: ["ops@ndi.com"] };
    const acc = account({
      rules: [
        { id: "r1", match: { field: "channel", op: "equals", value: "email" }, notify: [target] },
        {
          id: "r2",
          match: { field: "from.domain", op: "equals", value: "bigclient.com" },
          notify: [target],
        },
      ],
    });

    const result = resolveMessage(message, acc);
    expect(result.matchedRules).toHaveLength(2);
    expect(result.targets).toHaveLength(1);
  });

  it("falls back to the account default when nothing matches", () => {
    const acc = account({
      rules: [
        {
          id: "r1",
          match: { field: "channel", op: "equals", value: "linkedin" },
          notify: [{ type: "slack" }],
        },
      ],
      defaultNotify: [{ type: "email", to: ["catchall@ndi.com"] }],
    });

    const result = resolveMessage(message, acc);
    expect(result.matchedRules).toHaveLength(0);
    expect(result.targets).toEqual([{ type: "email", to: ["catchall@ndi.com"] }]);
  });

  it("notifies nobody when nothing matches and there is no default", () => {
    const acc = account({ rules: [] });
    const result = resolveMessage(message, acc);
    expect(result.targets).toEqual([]);
  });
});
