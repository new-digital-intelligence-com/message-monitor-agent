import type { Logger } from "pino";
import type { Transporter } from "nodemailer";
import { formatSummary } from "./format.js";
import { sendSlackNotification } from "./slack.js";
import { sendEmailNotification } from "./email.js";
import { sendWebhookNotification } from "./webhook.js";
import type { AccountConfig, NotifyTarget } from "../types.js";
import type { RuleResolution } from "../filters/resolve.js";

export interface NotifierDeps {
  slackBotToken?: string;
  emailTransport?: { transporter: Transporter; from: string };
  logger: Logger;
}

/** Fans a matched message out to every resolved notify target. Each target
 * is delivered independently — one failing (e.g. bad webhook URL) never
 * blocks the others. */
export class NotificationRouter {
  constructor(private readonly deps: NotifierDeps) {}

  async dispatch(resolution: RuleResolution, account: AccountConfig): Promise<void> {
    if (resolution.targets.length === 0) return;

    const { title, text } = formatSummary(resolution.message, account, resolution.matchedRules);

    await Promise.all(
      resolution.targets.map((target) => this.send(target, title, text, resolution, account)),
    );
  }

  private async send(
    target: NotifyTarget,
    title: string,
    text: string,
    resolution: RuleResolution,
    account: AccountConfig,
  ): Promise<void> {
    try {
      switch (target.type) {
        case "slack":
          await sendSlackNotification(target, title, text, this.deps.slackBotToken);
          return;
        case "email":
          if (!this.deps.emailTransport) {
            throw new Error("Email notify target configured but no SMTP transport was set up");
          }
          await sendEmailNotification(this.deps.emailTransport, target.to, title, text);
          return;
        case "webhook":
          await sendWebhookNotification(target.url, target.headers, {
            account: { id: account.id, label: account.label },
            message: resolution.message,
            matchedRules: resolution.matchedRules.map((r) => r.id),
          });
          return;
      }
    } catch (err) {
      this.deps.logger.error(
        { err, target, accountId: account.id, messageId: resolution.message.id },
        "notification delivery failed",
      );
    }
  }
}
