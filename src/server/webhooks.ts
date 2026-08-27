import express, { type Express } from "express";
import type { Logger } from "pino";
import type { LinkedInAccountConfig } from "../types.js";
import {
  normalizeUnipileEvent,
  verifyUnipileSignature,
  type UnipileMessageWebhookPayload,
} from "../adapters/linkedin/unipile.js";
import type { CheckpointStore } from "../store/checkpoints.js";
import { resolveMessage } from "../filters/resolve.js";
import type { NotificationRouter } from "../notify/router.js";

export interface WebhookServerOptions {
  linkedinAccounts: LinkedInAccountConfig[];
  unipileWebhookSecret?: string;
  store: CheckpointStore;
  router: NotificationRouter;
  logger: Logger;
}

export function createWebhookServer(opts: WebhookServerOptions): Express {
  const app = express();
  const accountsByUnipileId = new Map(opts.linkedinAccounts.map((a) => [a.unipileAccountId, a]));

  app.post("/webhooks/unipile", express.raw({ type: "*/*", limit: "2mb" }), (req, res) => {
    const rawBody = req.body instanceof Buffer ? req.body.toString("utf8") : "";

    if (opts.unipileWebhookSecret) {
      const signatureHeader = req.header("unipile-signature");
      if (!verifyUnipileSignature(signatureHeader, rawBody, opts.unipileWebhookSecret)) {
        opts.logger.warn("rejected Unipile webhook with invalid or missing signature");
        res.status(401).send("invalid signature");
        return;
      }
    }

    let payload: UnipileMessageWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as UnipileMessageWebhookPayload;
    } catch {
      res.status(400).send("invalid JSON");
      return;
    }

    // Ack immediately — Unipile expects a prompt 2xx before further processing.
    res.status(200).send("ok");

    void handleEvent(payload, opts, accountsByUnipileId);
  });

  app.get("/healthz", (_req, res) => {
    res.status(200).send("ok");
  });

  return app;
}

async function handleEvent(
  payload: UnipileMessageWebhookPayload,
  opts: WebhookServerOptions,
  accountsByUnipileId: Map<string, LinkedInAccountConfig>,
): Promise<void> {
  try {
    const account = accountsByUnipileId.get(payload.account_id);
    if (!account) {
      opts.logger.warn(
        { unipileAccountId: payload.account_id },
        "webhook event for an unconfigured LinkedIn account",
      );
      return;
    }
    if (account.enabled === false) return;

    const message = normalizeUnipileEvent(account.id, payload);
    if (!message) return; // not a message_received event

    if (opts.store.hasSeen(account.id, message.id)) return;
    opts.store.markSeen(account.id, message.id);

    const resolution = resolveMessage(message, account);
    opts.logger.info(
      {
        accountId: account.id,
        messageId: message.id,
        matchedRules: resolution.matchedRules.map((r) => r.id),
        targets: resolution.targets.length,
      },
      "linkedin message processed",
    );
    await opts.router.dispatch(resolution, account);
  } catch (err) {
    opts.logger.error({ err }, "failed to process Unipile webhook event");
  }
}
