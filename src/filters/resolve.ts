import { evaluateCondition } from "./engine.js";
import type { AccountConfig, FilterRule, NormalizedMessage, NotifyTarget } from "../types.js";

export interface RuleResolution {
  message: NormalizedMessage;
  matchedRules: FilterRule[];
  /** Deduplicated notify targets from every matched rule, or the account's
   * defaultNotify when nothing matched and one is configured. */
  targets: NotifyTarget[];
}

function targetKey(target: NotifyTarget): string {
  switch (target.type) {
    case "slack":
      return `slack:${target.channel ?? ""}:${target.userId ?? ""}:${target.webhookUrl ?? ""}`;
    case "email":
      return `email:${[...target.to].sort().join(",")}`;
    case "webhook":
      return `webhook:${target.url}`;
  }
}

function dedupeTargets(targets: NotifyTarget[]): NotifyTarget[] {
  const seen = new Map<string, NotifyTarget>();
  for (const target of targets) {
    seen.set(targetKey(target), target);
  }
  return [...seen.values()];
}

export function resolveMessage(message: NormalizedMessage, account: AccountConfig): RuleResolution {
  const matchedRules = account.rules.filter((rule) => evaluateCondition(message, rule.match));

  const targets =
    matchedRules.length > 0
      ? dedupeTargets(matchedRules.flatMap((rule) => rule.notify))
      : (account.defaultNotify ?? []);

  return { message, matchedRules, targets };
}
