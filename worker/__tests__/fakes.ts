import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Database, Env, Fetcher, KeyValue, Statement } from '../env';
import { handleApi } from '../router';

// Vite 5 does not know node:sqlite as a built-in and would try to bundle it: load it at run time.
const sqlite = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

/** D1 stand-in: the real schema in an in-memory SQLite (node:sqlite). */
class SqliteStatement implements Statement {
  constructor(private readonly db: DatabaseSync, private readonly sql: string, private readonly values: SQLInputValue[] = []) {}

  bind(...values: unknown[]): Statement {
    return new SqliteStatement(this.db, this.sql, values.map((v) => (v === undefined ? null : (v as SQLInputValue))));
  }

  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    return { meta: { changes: Number(this.db.prepare(this.sql).run(...this.values).changes) } };
  }
}

export function memoryDatabase(): Database & { sql: DatabaseSync } {
  const sql = new sqlite.DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  const migrations = new URL('../../migrations/', import.meta.url);
  for (const name of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    sql.exec(readFileSync(new URL(name, migrations), 'utf8'));
  }
  return {
    sql,
    prepare: (text) => new SqliteStatement(sql, text),
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        sql.exec('COMMIT');
        return out;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

export function memoryFiles(): KeyValue & { keys: () => string[] } {
  const map = new Map<string, Uint8Array>();
  return {
    keys: () => [...map.keys()],
    async list({ prefix, limit }) {
      const keys = [...map.keys()].filter((key) => key.startsWith(prefix));
      return { keys: keys.slice(0, limit).map((name) => ({ name })), list_complete: limit === undefined || keys.length <= limit };
    },
    async get(key) {
      const data = map.get(key);
      return data ? new Blob([new Uint8Array(data)]).stream() : null;
    },
    async put(key, value) {
      map.set(key, new Uint8Array(value));
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

export const ORIGIN = 'http://localhost:8787';

export interface Call {
  readonly cookie?: string;
  readonly json?: unknown;
  readonly form?: FormData;
  readonly origin?: string | null;
  readonly base?: string;
}

/** A tiny client of the API in process: requests in, responses out, the session cookie carried by hand. */
export class TestClient {
  now = Date.UTC(2026, 9, 12);
  fetcher: Fetcher = async () => new Response('offline', { status: 503 });

  constructor(readonly env: Env) {}

  async call(method: string, path: string, o: Call = {}): Promise<Response> {
    const headers = new Headers();
    if (o.cookie) headers.set('Cookie', o.cookie);
    const origin = o.origin === undefined ? ORIGIN : o.origin;
    if (origin) headers.set('Origin', origin);
    let body: BodyInit | undefined;
    if (o.json !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(o.json);
    } else if (o.form) body = o.form;
    let request = new Request(`${o.base ?? ORIGIN}${path}`, { method, headers, body });
    if (o.form) {
      const packed = await request.arrayBuffer();
      request.headers.set('Content-Length', String(packed.byteLength));
      request = new Request(request.url, { method, headers: request.headers, body: packed });
    }
    return handleApi(request, this.env, this.fetcher, this.now);
  }

  /** Dev sign-in; returns the cookie header to send back. */
  async signIn(email: string, name: string): Promise<string> {
    const res = await this.call('POST', '/api/auth/dev', { json: { email, name } });
    if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
    return cookieFrom(res);
  }
}

/** The name=value part of the session cookie a response sets. */
export function cookieFrom(res: Response): string {
  const set = res.headers.getSetCookie().find((c) => c.startsWith('__Host-hoodoo-session='));
  if (!set) throw new Error('no session cookie');
  return set.split(';')[0];
}

export const fakeScene = (n = 64): Uint8Array => new Uint8Array(gzipSync(JSON.stringify({
  format: 'hoodoo-scene', version: 3, scene: { objects: [] }, padding: 'x'.repeat(n),
})));
const JPEG = readFileSync(new URL('./thumb.jpg', import.meta.url));
export const fakeThumb = (n = 64): Uint8Array => {
  const bytes = new Uint8Array(Math.max(n, JPEG.length));
  bytes.set(JPEG);
  return bytes;
};

export function upload(name: string, scene: Uint8Array = fakeScene(), thumb: Uint8Array | null = fakeThumb()): FormData {
  const form = new FormData();
  form.append('name', name);
  form.append('scene', new Blob([new Uint8Array(scene)], { type: 'application/gzip' }), 'scene.gz');
  if (thumb) form.append('thumb', new Blob([new Uint8Array(thumb)], { type: 'image/jpeg' }), 'thumb.jpg');
  return form;
}

export function testEnv(extra: Partial<Env> = {}): Env & { DB: ReturnType<typeof memoryDatabase>; FILES_KV: ReturnType<typeof memoryFiles> } {
  return { DB: memoryDatabase(), FILES_KV: memoryFiles(), DEV_LOGIN: '1', MODERATORS: 'mod@example.com', ...extra } as never;
}
