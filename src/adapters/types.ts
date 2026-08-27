import type { NormalizedMessage } from "../types.js";

export interface FetchResult {
  messages: NormalizedMessage[];
  /** Cursor to persist and pass back in on the next call. */
  nextCursor: string | null;
}

export interface SourceAdapter {
  readonly accountId: string;
  /**
   * Fetch messages that arrived after `cursor` (the value this adapter itself
   * returned last time). `cursor === null` means "first run for this account":
   * adapters should capture a baseline cursor and return no messages, rather
   * than flooding notifications with the account's entire history.
   */
  fetchNew(cursor: string | null): Promise<FetchResult>;
}
