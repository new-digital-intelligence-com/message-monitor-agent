import Database from "better-sqlite3";

/** Per-account poll cursors, plus a short-lived "seen message" set so a
 * cursor boundary quirk (e.g. IMAP's "n:*" range, an overlapping Gmail
 * history page) can never cause a duplicate notification. */
export class CheckpointStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        account_id TEXT PRIMARY KEY,
        cursor TEXT
      );
      CREATE TABLE IF NOT EXISTS seen_messages (
        account_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        seen_at TEXT NOT NULL,
        PRIMARY KEY (account_id, message_id)
      );
    `);
  }

  getCursor(accountId: string): string | null {
    const row = this.db
      .prepare("SELECT cursor FROM checkpoints WHERE account_id = ?")
      .get(accountId) as { cursor: string | null } | undefined;
    return row?.cursor ?? null;
  }

  setCursor(accountId: string, cursor: string | null): void {
    this.db
      .prepare(
        `INSERT INTO checkpoints (account_id, cursor) VALUES (?, ?)
         ON CONFLICT(account_id) DO UPDATE SET cursor = excluded.cursor`,
      )
      .run(accountId, cursor);
  }

  hasSeen(accountId: string, messageId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM seen_messages WHERE account_id = ? AND message_id = ?")
      .get(accountId, messageId);
    return row !== undefined;
  }

  markSeen(accountId: string, messageId: string): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO seen_messages (account_id, message_id, seen_at) VALUES (?, ?, ?)",
      )
      .run(accountId, messageId, new Date().toISOString());
  }

  /** Keeps the seen-message table from growing unbounded. */
  pruneSeen(olderThanDays = 30): void {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    this.db.prepare("DELETE FROM seen_messages WHERE seen_at < ?").run(cutoff);
  }

  close(): void {
    this.db.close();
  }
}
