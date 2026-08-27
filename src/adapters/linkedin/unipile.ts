import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedMessage } from "../../types.js";

/**
 * Field names below are confirmed against Unipile's public docs
 * (developer.unipile.com/docs/new-messages-webhook, /docs/webhooks-2) as of
 * 2026-08-27: X-API-KEY auth, cursor-paginated /api/v1/chats, and this
 * webhook payload shape. Unipile's polling GET /chats/{id}/messages response
 * schema was NOT independently verified while building this (docs excerpts
 * only, not a captured live response) — treat `UnipileClient.listRecentMessages`
 * below as best-effort and confirm field names against a real response or
 * Unipile's OpenAPI spec before relying on it. The webhook path is the
 * verified, recommended way to ingest LinkedIn messages here.
 */
export interface UnipileMessageWebhookPayload {
  account_id: string;
  account_type: "LINKEDIN" | "INSTAGRAM" | "WHATSAPP" | "TELEGRAM" | "MESSENGER" | "TWITTER";
  account_info: { type: string; feature: string; user_id: string };
  event:
    | "message_received"
    | "message_reaction"
    | "message_read"
    | "message_edited"
    | "message_deleted"
    | "message_delivered";
  chat_id: string;
  timestamp: string;
  webhook_name: string;
  message_id: string;
  message: string;
  sender: {
    attendee_id: string;
    attendee_name: string;
    attendee_provider_id: string;
    attendee_profile_url?: string;
  };
}

/**
 * Verifies the `unipile-signature` header: `t=<unix seconds>,v0=<hex hmac>`
 * over `${t}.${rawBody}`, HMAC-SHA256 keyed by the webhook's endpoint secret.
 */
export function verifyUnipileSignature(
  header: string | undefined,
  rawBody: string,
  secret: string,
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k?.trim(), v?.trim()];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v0;
  if (!timestamp || !signature) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeUnipileEvent(
  accountId: string,
  payload: UnipileMessageWebhookPayload,
): NormalizedMessage | null {
  if (payload.event !== "message_received") return null;

  return {
    id: payload.message_id,
    accountId,
    channel: "linkedin",
    receivedAt: payload.timestamp,
    from: { name: payload.sender.attendee_name, address: payload.sender.attendee_provider_id },
    subject: undefined,
    bodyText: payload.message,
    snippet: payload.message.slice(0, 200),
    threadId: payload.chat_id,
    linkedinType: "message",
    raw: payload,
  };
}

/** Thin REST client for the confirmed parts of the Unipile API (auth + chat
 * listing). See the module-level note above about the messages endpoint. */
export class UnipileClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }
    const res = await fetch(url, { headers: { "X-API-KEY": this.apiKey } });
    if (!res.ok) {
      throw new Error(`Unipile request failed: ${res.status} ${res.statusText} (${url.pathname})`);
    }
    return (await res.json()) as T;
  }

  /** Lists chats for a given Unipile account, cursor-paginated. */
  async listChats(
    accountId: string,
    cursor?: string,
  ): Promise<{ items: unknown[]; cursor: string | null }> {
    return this.request("/api/v1/chats", {
      account_id: accountId,
      ...(cursor ? { cursor } : {}),
    });
  }
}
