import { afterEach, describe, expect, it } from "vitest";
import { CheckpointStore } from "./checkpoints.js";

describe("CheckpointStore", () => {
  let store: CheckpointStore;

  afterEach(() => {
    store?.close();
  });

  it("returns null for an account with no stored cursor", () => {
    store = new CheckpointStore(":memory:");
    expect(store.getCursor("acc-1")).toBeNull();
  });

  it("round-trips a cursor and overwrites it on update", () => {
    store = new CheckpointStore(":memory:");
    store.setCursor("acc-1", "1000");
    expect(store.getCursor("acc-1")).toBe("1000");
    store.setCursor("acc-1", "2000");
    expect(store.getCursor("acc-1")).toBe("2000");
  });

  it("tracks seen messages per account independently", () => {
    store = new CheckpointStore(":memory:");
    expect(store.hasSeen("acc-1", "msg-1")).toBe(false);
    store.markSeen("acc-1", "msg-1");
    expect(store.hasSeen("acc-1", "msg-1")).toBe(true);
    expect(store.hasSeen("acc-2", "msg-1")).toBe(false);
  });

  it("markSeen is idempotent", () => {
    store = new CheckpointStore(":memory:");
    store.markSeen("acc-1", "msg-1");
    expect(() => store.markSeen("acc-1", "msg-1")).not.toThrow();
  });

  it("prunes seen entries older than the cutoff", () => {
    store = new CheckpointStore(":memory:");
    store.markSeen("acc-1", "old-msg");
    // Backdate it directly since markSeen always stamps "now".
    store["db"]
      .prepare("UPDATE seen_messages SET seen_at = ? WHERE message_id = ?")
      .run(new Date(Date.now() - 40 * 86_400_000).toISOString(), "old-msg");
    store.markSeen("acc-1", "recent-msg");

    store.pruneSeen(30);

    expect(store.hasSeen("acc-1", "old-msg")).toBe(false);
    expect(store.hasSeen("acc-1", "recent-msg")).toBe(true);
  });
});
