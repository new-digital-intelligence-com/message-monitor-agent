import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import { requireEnv } from "../../config/load.js";
import type { ImapAccountConfig, NormalizedMessage } from "../../types.js";
import type { FetchResult, SourceAdapter } from "../types.js";

function addressesOf(field: AddressObject | AddressObject[] | undefined): string[] {
  if (!field) return [];
  const objects = Array.isArray(field) ? field : [field];
  return objects.flatMap((o) => o.value.map((v) => v.address ?? "").filter(Boolean));
}

export function createImapAdapter(account: ImapAccountConfig): SourceAdapter {
  const user = requireEnv(account.userEnv);
  const pass = requireEnv(account.passwordEnv);
  const mailbox = account.mailbox ?? "INBOX";

  async function withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: account.host,
      port: account.port,
      secure: account.secure,
      auth: { user, pass },
      logger: false,
    });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  return {
    accountId: account.id,

    async fetchNew(cursor: string | null): Promise<FetchResult> {
      return withClient(async (client) => {
        const lock = await client.getMailboxLock(mailbox);
        try {
          const uidNext =
            client.mailbox && "uidNext" in client.mailbox ? client.mailbox.uidNext : undefined;

          if (cursor === null) {
            // First run: baseline on the current highest UID, emit nothing yet.
            return { messages: [], nextCursor: uidNext ? String(uidNext - 1) : "0" };
          }

          const lastSeenUid = Number(cursor);
          const messages: NormalizedMessage[] = [];
          let maxUid = lastSeenUid;

          // IMAP's "n:*" range always returns at least the last message even
          // when n is past it, so re-filter defensively below.
          for await (const msg of client.fetch(
            `${lastSeenUid + 1}:*`,
            { uid: true, source: true },
            { uid: true },
          )) {
            if (msg.uid <= lastSeenUid || !msg.source) continue;
            maxUid = Math.max(maxUid, msg.uid);

            const parsed = await simpleParser(msg.source);
            const from = parsed.from?.value[0];
            messages.push({
              id: String(msg.uid),
              accountId: account.id,
              channel: "email",
              receivedAt: (parsed.date ?? new Date()).toISOString(),
              from: { name: from?.name, address: from?.address ?? "" },
              to: addressesOf(parsed.to),
              subject: parsed.subject,
              bodyText: parsed.text,
              bodyHtml: typeof parsed.html === "string" ? parsed.html : undefined,
              snippet: parsed.text?.slice(0, 200),
            });
          }

          return { messages, nextCursor: String(maxUid) };
        } finally {
          lock.release();
        }
      });
    },
  };
}
