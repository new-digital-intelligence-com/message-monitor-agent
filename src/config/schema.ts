import { z } from "zod";

const matchFieldSchema = z.enum([
  "from.address",
  "from.name",
  "from.domain",
  "to",
  "subject",
  "body",
  "label",
  "channel",
  "linkedinType",
]);

// MatchCondition is recursive (all/any/not nest other conditions), so it needs
// an explicit z.ZodType annotation — z.lazy() alone can't infer the type back.
export const matchConditionSchema: z.ZodType<import("../types.js").MatchCondition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(matchConditionSchema).min(1) }),
    z.object({ any: z.array(matchConditionSchema).min(1) }),
    z.object({ not: matchConditionSchema }),
    z.object({
      field: matchFieldSchema,
      op: z.enum(["contains", "equals", "startsWith", "endsWith"]),
      value: z.string(),
      caseSensitive: z.boolean().optional(),
    }),
    z.object({
      field: matchFieldSchema,
      op: z.literal("matches"),
      pattern: z.string(),
      caseSensitive: z.boolean().optional(),
    }),
    z.object({
      field: matchFieldSchema,
      op: z.literal("in"),
      values: z.array(z.string()).min(1),
    }),
  ]),
);

const notifyTargetSchema = z.union([
  z.object({
    type: z.literal("slack"),
    channel: z.string().optional(),
    userId: z.string().optional(),
    webhookUrl: z.string().url().optional(),
  }),
  z.object({ type: z.literal("email"), to: z.array(z.string().email()).min(1) }),
  z.object({
    type: z.literal("webhook"),
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
  }),
]);

const filterRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  match: matchConditionSchema,
  notify: z.array(notifyTargetSchema).min(1),
});

const baseAccountSchema = {
  id: z.string().min(1),
  label: z.string().min(1),
  defaultNotify: z.array(notifyTargetSchema).optional(),
  rules: z.array(filterRuleSchema).default([]),
  pollIntervalSeconds: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
};

const gmailAccountSchema = z.object({
  ...baseAccountSchema,
  channel: z.literal("email"),
  provider: z.literal("gmail"),
  refreshTokenEnv: z.string().min(1),
  clientIdEnv: z.string().min(1),
  clientSecretEnv: z.string().min(1),
  labelIds: z.array(z.string()).optional(),
});

const imapAccountSchema = z.object({
  ...baseAccountSchema,
  channel: z.literal("email"),
  provider: z.literal("imap"),
  host: z.string().min(1),
  port: z.number().int().positive(),
  secure: z.boolean(),
  userEnv: z.string().min(1),
  passwordEnv: z.string().min(1),
  mailbox: z.string().optional(),
});

const linkedinAccountSchema = z.object({
  ...baseAccountSchema,
  channel: z.literal("linkedin"),
  provider: z.literal("unipile"),
  unipileAccountId: z.string().min(1),
});

// A plain union rather than a nested discriminatedUnion: two branches
// ("gmail" and "imap") share channel "email", which a discriminatedUnion
// can't key on at the top level, and TS can't carry the discriminant
// through a discriminatedUnion nested inside another one.
const accountConfigSchema = z.union([gmailAccountSchema, imapAccountSchema, linkedinAccountSchema]);

export const appConfigSchema = z.object({
  unipile: z
    .object({
      baseUrlEnv: z.string().min(1),
      apiKeyEnv: z.string().min(1),
      webhookSecretEnv: z.string().optional(),
    })
    .optional(),
  slack: z
    .object({
      botTokenEnv: z.string().optional(),
    })
    .optional(),
  smtp: z
    .object({
      host: z.string().min(1),
      port: z.number().int().positive(),
      secure: z.boolean(),
      userEnv: z.string().min(1),
      passwordEnv: z.string().min(1),
      from: z.string().min(1),
    })
    .optional(),
  accounts: z.array(accountConfigSchema).min(1),
});
