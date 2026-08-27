import { google, gmail_v1 } from "googleapis";
import { requireEnv } from "../../config/load.js";
import type { GmailAccountConfig, NormalizedMessage } from "../../types.js";
import type { FetchResult, SourceAdapter } from "../types.js";

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): {
  text?: string;
  html?: string;
} {
  if (!payload) return {};

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return { text: decodeBase64Url(payload.body.data) };
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return { html: decodeBase64Url(payload.body.data) };
  }

  let text: string | undefined;
  let html: string | undefined;
  for (const part of payload.parts ?? []) {
    const found = extractBody(part);
    text ??= found.text;
    html ??= found.html;
  }
  return { text, html };
}

function headerValue(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string | undefined {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

function parseAddress(headerVal: string | undefined): { name?: string; address: string } {
  if (!headerVal) return { address: "" };
  const match = /^(.*?)\s*<(.+)>$/.exec(headerVal.trim());
  if (match) {
    const name = match[1]?.replace(/^"|"$/g, "").trim();
    return { name: name || undefined, address: (match[2] ?? "").trim() };
  }
  return { address: headerVal.trim() };
}

function toNormalized(accountId: string, msg: gmail_v1.Schema$Message): NormalizedMessage {
  const headers = msg.payload?.headers;
  const from = parseAddress(headerValue(headers, "From"));
  const toHeader = headerValue(headers, "To");
  const body = extractBody(msg.payload);

  return {
    id: msg.id ?? "",
    accountId,
    channel: "email",
    receivedAt: msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : new Date().toISOString(),
    from,
    to: toHeader ? toHeader.split(",").map((s) => s.trim()) : undefined,
    subject: headerValue(headers, "Subject"),
    bodyText: body.text,
    bodyHtml: body.html,
    snippet: msg.snippet ?? undefined,
    threadId: msg.threadId ?? undefined,
    labels: msg.labelIds ?? undefined,
    raw: msg,
  };
}

export function createGmailAdapter(account: GmailAccountConfig): SourceAdapter {
  const clientId = requireEnv(account.clientIdEnv);
  const clientSecret = requireEnv(account.clientSecretEnv);
  const refreshToken = requireEnv(account.refreshTokenEnv);

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  async function currentHistoryId(): Promise<string> {
    const profile = await gmail.users.getProfile({ userId: "me" });
    return String(profile.data.historyId);
  }

  return {
    accountId: account.id,

    async fetchNew(cursor: string | null): Promise<FetchResult> {
      if (cursor === null) {
        // First run: capture a baseline so we don't notify on the whole mailbox.
        return { messages: [], nextCursor: await currentHistoryId() };
      }

      let addedIds: string[] = [];
      let latestHistoryId = cursor;

      try {
        let pageToken: string | undefined;
        do {
          const res = await gmail.users.history.list({
            userId: "me",
            startHistoryId: cursor,
            historyTypes: ["messageAdded"],
            labelId: account.labelIds?.[0],
            pageToken,
          });
          for (const record of res.data.history ?? []) {
            for (const added of record.messagesAdded ?? []) {
              if (added.message?.id) addedIds.push(added.message.id);
            }
          }
          if (res.data.historyId) latestHistoryId = res.data.historyId;
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
      } catch (err: unknown) {
        // A too-old startHistoryId (404) means we fell out of Gmail's history
        // window; re-baseline instead of erroring out the whole poll cycle.
        const status =
          (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
        if (status === 404) {
          return { messages: [], nextCursor: await currentHistoryId() };
        }
        throw err;
      }

      addedIds = [...new Set(addedIds)];
      const messages: NormalizedMessage[] = [];
      for (const id of addedIds) {
        const full = await gmail.users.messages.get({ userId: "me", id, format: "full" });
        messages.push(toNormalized(account.id, full.data));
      }

      return { messages, nextCursor: latestHistoryId };
    },
  };
}
