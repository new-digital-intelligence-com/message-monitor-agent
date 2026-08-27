# message-monitor-agent

Monitors multiple email and LinkedIn accounts, matches incoming messages against per-account
declarative filter rules, and routes matches to Slack, email, or a webhook — with the receiver
configurable per rule so different message types reach the right person.

## Architecture

```
Gmail (poll, Gmail History API)  ─┐
Generic IMAP mailbox (poll)      ─┼─► NormalizedMessage ─► filter rule engine ─► NotificationRouter
LinkedIn via Unipile (webhook)   ─┘                                                ├─ Slack
                                                                                    ├─ Email (SMTP)
                                                                                    └─ Webhook
```

- **One process, many accounts.** `config/accounts.yaml` lists every mailbox/LinkedIn account this
  instance watches; each carries its own rules and its own default notify target(s), so one deployment
  serves multiple owners.
- **Email** is polled (Gmail via the History API, or any IMAP mailbox) on a per-account interval
  (`pollIntervalSeconds`, default 60s).
- **LinkedIn** is ingested via [Unipile](https://www.unipile.com)'s real-time webhook
  (`message_received` events), signature-verified with the `unipile-signature` header. This is the
  verified, recommended integration path per Unipile's docs — see the caveat below on the polling API.
- **Filter rules** are declarative (`all`/`any`/`not` over field conditions: sender/domain, subject,
  body keyword or regex, labels, LinkedIn message type) — no LLM call needed to filter, so it's cheap,
  fast, and deterministic. See `config/accounts.example.yaml` for the full shape.
- **Notify targets** (Slack, email, webhook) are set **per rule**, so different message types route to
  different people; an account-level `defaultNotify` covers anything no rule matched.
- **Dedup/checkpointing** is a local SQLite file (`data/checkpoints.sqlite`): one cursor per account,
  plus a short-lived seen-message set so a cursor-boundary quirk can never cause a duplicate notification.

## Setup

```bash
pnpm install
cp .env.example .env            # fill in the secrets your accounts.yaml references
cp config/accounts.example.yaml config/accounts.yaml   # then edit accounts/rules
pnpm start
```

`pnpm dev` runs with file-watch reload. `PORT` (default 3000) is where the Unipile webhook endpoint
(`POST /webhooks/unipile`) and a `GET /healthz` are served.

### Per-account setup

- **Gmail**: needs an OAuth2 client (`clientIdEnv`/`clientSecretEnv`) and a refresh token
  (`refreshTokenEnv`) scoped to `https://www.googleapis.com/auth/gmail.readonly` for that mailbox.
- **IMAP**: any mailbox reachable over IMAP — `host`/`port`/`secure` plus a user/password env pair.
- **LinkedIn (Unipile)**: connect the LinkedIn account inside Unipile first (their auth flow, not this
  app's), then reference its `unipileAccountId` here and point a Unipile webhook at
  `https://<your-deployment>/webhooks/unipile`.

On an account's first poll (`cursor === null`), the app captures a baseline instead of emitting
messages — so turning this on doesn't flood notifications with an account's entire history.

## Filter rule reference

A rule's `match` is one condition, composable via `all`/`any`/`not`:

```yaml
match:
  all:
    - field: from.domain
      op: equals
      value: bigclient.com
    - any:
        - field: subject
          op: contains
          value: urgent
        - field: body
          op: matches
          pattern: "\\basap\\b"
```

Fields: `from.address`, `from.name`, `from.domain`, `to`, `subject`, `body`, `label`, `channel`,
`linkedinType`. Ops: `contains` / `equals` / `startsWith` / `endsWith` (case-insensitive unless
`caseSensitive: true`), `matches` (regex), `in` (value set). Array-valued fields (`to`, `label`) match
if _any_ element satisfies the condition.

## Known gaps / caveats

- **Unipile's polling `GET /chats/{id}/messages` response schema was not independently verified**
  while building this (docs excerpts only, not a captured live response) — `UnipileClient` in
  `src/adapters/linkedin/unipile.ts` is a thin, best-effort REST client kept for optional backfill and
  is not wired into the running app. The webhook path used for live ingestion (event/field names) _was_
  confirmed against Unipile's published docs. Verify the polling schema against a real response before
  depending on it.
- **LinkedIn invitations** (connection requests) are not handled — only `message_received` webhook
  events are normalized today. Unipile has separate webhook events for invitations that would need the
  same treatment (verify field names, extend `normalizeUnipileEvent`) before this app would surface them.
- No persistence beyond the local SQLite checkpoint file — running multiple replicas against the same
  accounts will duplicate polling and process the same messages independently unless the checkpoint DB
  is shared (e.g. moved to a network volume) or the deployment is kept to a single instance.

## Quality gates

```bash
pnpm check   # prettier --check, eslint, tsc --noEmit, vitest
```

I/O (Gmail, IMAP, Unipile, Slack, SMTP, SQLite) is not exercised by the test suite — `src/**/*.test.ts`
covers pure logic only (the filter engine, rule resolution/routing, checkpoint store against an in-memory
SQLite, and the Unipile webhook normalizer/signature verifier against fixture payloads).
