import type { Logger } from "pino";
import type { EmailAccountConfig } from "../types.js";
import type { SourceAdapter } from "../adapters/types.js";
import type { CheckpointStore } from "../store/checkpoints.js";
import { resolveMessage } from "../filters/resolve.js";
import type { NotificationRouter } from "../notify/router.js";

export interface PollableAccount {
  account: EmailAccountConfig;
  adapter: SourceAdapter;
}

const DEFAULT_POLL_INTERVAL_SECONDS = 60;

/** Polls every configured email account on its own interval, deduping via
 * the checkpoint store and routing matches to their notify targets. */
export class Poller {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly store: CheckpointStore,
    private readonly router: NotificationRouter,
    private readonly logger: Logger,
  ) {}

  start(accounts: PollableAccount[]): void {
    for (const entry of accounts) {
      if (entry.account.enabled === false) continue;
      void this.pollOnce(entry);
      const intervalMs =
        (entry.account.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS) * 1000;
      const timer = setInterval(() => void this.pollOnce(entry), intervalMs);
      this.timers.set(entry.account.id, timer);
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }

  private async pollOnce({ account, adapter }: PollableAccount): Promise<void> {
    try {
      const cursor = this.store.getCursor(account.id);
      const { messages, nextCursor } = await adapter.fetchNew(cursor);

      for (const message of messages) {
        if (this.store.hasSeen(account.id, message.id)) continue;
        this.store.markSeen(account.id, message.id);

        const resolution = resolveMessage(message, account);
        this.logger.info(
          {
            accountId: account.id,
            messageId: message.id,
            matchedRules: resolution.matchedRules.map((r) => r.id),
            targets: resolution.targets.length,
          },
          "message processed",
        );
        await this.router.dispatch(resolution, account);
      }

      this.store.setCursor(account.id, nextCursor);
    } catch (err) {
      this.logger.error({ err, accountId: account.id }, "poll cycle failed");
    }
  }
}
