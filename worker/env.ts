/**
 * The Worker's bindings and settings (wrangler.jsonc, .dev.vars, `wrangler secret put`).
 * The storage types are the small parts of D1, R2 and KV this Worker uses, so the
 * code type-checks without @cloudflare/workers-types and tests can pass fakes.
 */

export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

/** D1. */
export interface Database {
  prepare(sql: string): Statement;
  /** Runs the statements in one transaction. */
  batch(statements: Statement[]): Promise<unknown[]>;
}

/** R2 (preferred for scene files and pictures). */
export interface Bucket {
  get(key: string): Promise<{ body: ReadableStream } | null>;
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

/** KV (the file store while R2 is not enabled on the account). */
export interface KeyValue {
  get(key: string, type: 'stream'): Promise<ReadableStream | null>;
  put(key: string, value: ArrayBuffer | Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The static site (dist/) the Worker sits in front of. */
export interface Assets {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  readonly DB: Database;
  readonly FILES?: Bucket;
  readonly FILES_KV?: KeyValue;
  readonly ASSETS?: Assets;
  /** The OAuth client ID of the Google Cloud project (public). Unset: Google sign-in is off. */
  readonly GOOGLE_CLIENT_ID?: string;
  /** Comma-separated emails of the moderators (a secret: it is not in the public repo). */
  readonly MODERATORS?: string;
  /** "1" in .dev.vars only: a sign-in without Google, on localhost only. */
  readonly DEV_LOGIN?: string;
  readonly TURNSTILE_SITE_KEY?: string;
  readonly TURNSTILE_SECRET?: string;
  /** Extra origins allowed to send changes besides the Worker's own (the Vite dev server). */
  readonly APP_ORIGINS?: string;
}

/** Network calls to Google and Turnstile; tests replace it. */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

export const isLocalHost = (url: URL): boolean => LOCAL_HOSTS.has(url.hostname);

/** Dev sign-in needs both the setting and a localhost address: a stray DEV_LOGIN in production does nothing. */
export const devLoginOn = (env: Env, url: URL): boolean => env.DEV_LOGIN === '1' && isLocalHost(url);

export const listOf = (text: string | undefined): string[] => (text ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const clientIdOf = (env: Env): string | null => env.GOOGLE_CLIENT_ID?.trim() || null;
