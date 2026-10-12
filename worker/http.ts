import { CloudErrorCode } from '../src/io/cloud/cloud-contract';

/** A refusal with its HTTP status: handlers throw it, the router turns it into JSON. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: CloudErrorCode, message: string) {
    super(message);
  }
}

export const STATUS = {
  ok: 200,
  created: 201,
  noContent: 204,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  methodNotAllowed: 405,
  tooLarge: 413,
  /** Precondition Required: the human check is due. */
  human: 428,
  tooMany: 429,
  server: 500,
  unavailable: 503,
} as const;

export const fail = {
  signIn: () => new ApiError(STATUS.unauthorized, CloudErrorCode.SignIn, 'Sign in first'),
  forbidden: (why = 'Not allowed') => new ApiError(STATUS.forbidden, CloudErrorCode.Forbidden, why),
  notFound: (what = 'Not found') => new ApiError(STATUS.notFound, CloudErrorCode.NotFound, what),
  invalid: (why: string) => new ApiError(STATUS.badRequest, CloudErrorCode.Invalid, why),
  tooLarge: (why: string) => new ApiError(STATUS.tooLarge, CloudErrorCode.TooLarge, why),
  tooMany: (why: string) => new ApiError(STATUS.tooMany, CloudErrorCode.TooMany, why),
  storageFull: () => new ApiError(STATUS.tooLarge, CloudErrorCode.StorageFull, 'Your cloud is full (50 MB): delete old projects'),
  busy: () => new ApiError(STATUS.unavailable, CloudErrorCode.Busy, 'Hoodoo Cloud is busy today, try again tomorrow'),
  human: () => new ApiError(STATUS.human, CloudErrorCode.Human, 'Confirm you are human'),
  notConfigured: (what: string) => new ApiError(STATUS.unavailable, CloudErrorCode.NotConfigured, what),
};

/** API answers are private and never cached unless a handler says otherwise. */
const API_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function json(body: unknown, status: number = STATUS.ok, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...API_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

export function bytes(body: ReadableStream, type: string, cache: string): Response {
  return new Response(body, { headers: { ...API_HEADERS, 'Content-Type': type, 'Cache-Control': cache } });
}

export function errorResponse(error: ApiError): Response {
  return json({ error: error.code, message: error.message }, error.status);
}

export const noContent = (headers: Record<string, string> = {}): Response => new Response(null, { status: STATUS.noContent, headers: { ...API_HEADERS, ...headers } });

export function cookieOf(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

export interface CookieSpec {
  readonly name: string;
  readonly value: string;
  readonly maxAgeS: number;
  readonly path?: string;
}

/** HttpOnly, Secure, SameSite=Lax: scripts cannot read it and other sites cannot send it with a change. */
export const setCookie = (c: CookieSpec): string => `${c.name}=${c.value}; Path=${c.path ?? '/'}; Max-Age=${c.maxAgeS}; HttpOnly; Secure; SameSite=Lax`;

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // Falls through to the refusal below.
  }
  throw fail.invalid('Expected a JSON object');
}

const ID_BYTES = 12;
const TOKEN_BYTES = 32;
const HEX = 16;
const HEX_PAIR = 2;

export function base64Url(data: Uint8Array): string {
  let s = '';
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const random = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

/** Unguessable ids for rows and file keys. */
export const newId = (): string => base64Url(random(ID_BYTES));
export const newToken = (): string => base64Url(random(TOKEN_BYTES));

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(HEX).padStart(HEX_PAIR, '0')).join('');
}

/** HTML text and attribute values. */
export const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
