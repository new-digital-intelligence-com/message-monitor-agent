import "dotenv/config";
import { pino } from "pino";
import { loadConfig, requireEnv } from "./config/load.js";
import { createGmailAdapter } from "./adapters/email/gmail.js";
import { createImapAdapter } from "./adapters/email/imap.js";
import { createEmailTransport } from "./notify/email.js";
import { NotificationRouter } from "./notify/router.js";
import { CheckpointStore } from "./store/checkpoints.js";
import { Poller, type PollableAccount } from "./orchestrator/poller.js";
import { createWebhookServer } from "./server/webhooks.js";
import type { AccountConfig } from "./types.js";

const logger = pino({
  transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
});

function isEmailAccount(a: AccountConfig): a is Extract<AccountConfig, { channel: "email" }> {
  return a.channel === "email";
}
function isLinkedInAccount(a: AccountConfig): a is Extract<AccountConfig, { channel: "linkedin" }> {
  return a.channel === "linkedin";
}

async function main(): Promise<void> {
  const configPath = process.env.CONFIG_PATH ?? "config/accounts.yaml";
  const config = loadConfig(configPath);
  logger.info({ accounts: config.accounts.length, path: configPath }, "loaded config");

  const dataDir = process.env.DATA_DIR ?? "data";
  const store = new CheckpointStore(`${dataDir}/checkpoints.sqlite`);

  const emailTransport = config.smtp ? createEmailTransport(config.smtp) : undefined;
  const slackBotToken = config.slack?.botTokenEnv
    ? requireEnv(config.slack.botTokenEnv)
    : undefined;

  const router = new NotificationRouter({ slackBotToken, emailTransport, logger });

  const emailAccounts = config.accounts.filter(isEmailAccount);
  const linkedinAccounts = config.accounts.filter(isLinkedInAccount);

  const pollable: PollableAccount[] = emailAccounts.map((account) => ({
    account,
    adapter:
      account.provider === "gmail" ? createGmailAdapter(account) : createImapAdapter(account),
  }));

  const poller = new Poller(store, router, logger);
  poller.start(pollable);
  logger.info({ count: pollable.length }, "started email pollers");

  const unipileWebhookSecret = config.unipile?.webhookSecretEnv
    ? requireEnv(config.unipile.webhookSecretEnv)
    : undefined;

  const app = createWebhookServer({
    linkedinAccounts,
    unipileWebhookSecret,
    store,
    router,
    logger,
  });

  const port = Number(process.env.PORT ?? 3000);
  const server = app.listen(port, () => {
    logger.info({ port, linkedinAccounts: linkedinAccounts.length }, "webhook server listening");
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    poller.stop();
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});
