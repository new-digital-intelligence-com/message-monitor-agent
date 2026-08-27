export type Channel = "email" | "linkedin";

export interface NormalizedMessage {
  /** Stable id within its account+channel, used for dedupe/checkpointing. */
  id: string;
  accountId: string;
  channel: Channel;
  receivedAt: string; // ISO 8601
  from: { name?: string; address: string };
  to?: string[];
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  snippet?: string;
  threadId?: string;
  labels?: string[];
  /** LinkedIn-specific: "message" | "invitation" | "inmail" | "comment". */
  linkedinType?: string;
  /** Provider's original payload, for notifiers/adapters that want raw access. */
  raw?: unknown;
}

// --- Filter rule conditions -------------------------------------------------

export type MatchCondition =
  | { all: MatchCondition[] }
  | { any: MatchCondition[] }
  | { not: MatchCondition }
  | {
      field: MatchField;
      op: "contains" | "equals" | "startsWith" | "endsWith";
      value: string;
      caseSensitive?: boolean;
    }
  | { field: MatchField; op: "matches"; pattern: string; caseSensitive?: boolean }
  | { field: MatchField; op: "in"; values: string[] };

export type MatchField =
  | "from.address"
  | "from.name"
  | "from.domain"
  | "to"
  | "subject"
  | "body"
  | "label"
  | "channel"
  | "linkedinType";

// --- Notification targets ---------------------------------------------------

export type NotifyTarget =
  | { type: "slack"; channel?: string; userId?: string; webhookUrl?: string }
  | { type: "email"; to: string[] }
  | { type: "webhook"; url: string; headers?: Record<string, string> };

export interface FilterRule {
  id: string;
  description?: string;
  match: MatchCondition;
  notify: NotifyTarget[];
}

// --- Accounts ----------------------------------------------------------------

export interface BaseAccount {
  id: string;
  /** Human label shown in notifications, e.g. "Jane Doe (Sales)". */
  label: string;
  /** Default receiver for rules on this account that don't set their own notify target. */
  defaultNotify?: NotifyTarget[];
  rules: FilterRule[];
  pollIntervalSeconds?: number;
  enabled?: boolean;
}

export interface GmailAccountConfig extends BaseAccount {
  channel: "email";
  provider: "gmail";
  /** Env var name holding the OAuth2 refresh token (never stored in config). */
  refreshTokenEnv: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  labelIds?: string[];
}

export interface ImapAccountConfig extends BaseAccount {
  channel: "email";
  provider: "imap";
  host: string;
  port: number;
  secure: boolean;
  userEnv: string;
  passwordEnv: string;
  mailbox?: string;
}

export type EmailAccountConfig = GmailAccountConfig | ImapAccountConfig;

export interface LinkedInAccountConfig extends BaseAccount {
  channel: "linkedin";
  provider: "unipile";
  /** Unipile account id (the LinkedIn account connected inside Unipile), not a secret. */
  unipileAccountId: string;
}

export type AccountConfig = EmailAccountConfig | LinkedInAccountConfig;

export interface AppConfig {
  unipile?: {
    baseUrlEnv: string;
    apiKeyEnv: string;
    /** Shared secret Unipile signs webhook payloads with, for verification. */
    webhookSecretEnv?: string;
  };
  slack?: {
    botTokenEnv?: string;
  };
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    userEnv: string;
    passwordEnv: string;
    from: string;
  };
  accounts: AccountConfig[];
}
