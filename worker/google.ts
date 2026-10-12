import type { Fetcher } from './env';
import { fail, fromBase64Url } from './http';

/**
 * Checks a Google ID token from Sign in with Google: an RS256 JWT signed with one of
 * Google's published keys, issued by Google, for our client ID, not expired, with a
 * verified email and the nonce of our sign-in page.
 */

export const GOOGLE_KEYS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS: ReadonlySet<string> = new Set(['accounts.google.com', 'https://accounts.google.com']);
const MS_PER_S = 1000;
/** Clock difference tolerated between Google and the edge. */
const SKEW_S = 60;
/** Keys are re-read at least this often even if Google's cache header says longer. */
const MAX_KEYS_AGE_MS = 6 * 60 * 60 * MS_PER_S;
const MAX_AGE = /max-age=(\d+)/;
const JWT_PARTS = 3;

export interface GoogleIdentity {
  readonly subject: string;
  readonly email: string;
  readonly name: string;
}

interface Jwk extends JsonWebKey {
  readonly kid?: string;
}

let keyCache: { keys: readonly Jwk[]; until: number } | null = null;

/** Forget the cached keys (tests). */
export const resetGoogleKeys = (): void => { keyCache = null; };

async function googleKeys(fetcher: Fetcher, now: number, refresh: boolean): Promise<readonly Jwk[]> {
  if (keyCache && !refresh && now < keyCache.until) return keyCache.keys;
  const res = await fetcher(GOOGLE_KEYS_URL);
  if (!res.ok) throw fail.notConfigured('Google keys are unavailable, try again');
  const body = (await res.json()) as { keys?: Jwk[] };
  const age = Number(MAX_AGE.exec(res.headers.get('Cache-Control') ?? '')?.[1] ?? 0) * MS_PER_S;
  keyCache = { keys: body.keys ?? [], until: now + Math.min(age, MAX_KEYS_AGE_MS) };
  return keyCache.keys;
}

const decodePart = (part: string): Record<string, unknown> => JSON.parse(new TextDecoder().decode(fromBase64Url(part))) as Record<string, unknown>;

export async function verifyGoogleToken(token: string, clientId: string, nonce: string | null, now: number, fetcher: Fetcher): Promise<GoogleIdentity> {
  const parts = token.split('.');
  if (parts.length !== JWT_PARTS) throw fail.invalid('Malformed sign-in token');
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = decodePart(parts[0]);
    claims = decodePart(parts[1]);
  } catch {
    throw fail.invalid('Malformed sign-in token');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw fail.invalid('Unexpected sign-in token');
  // A key Google rotated in since the cache was filled: read the keys once more.
  let jwk = (await googleKeys(fetcher, now, false)).find((k) => k.kid === header.kid);
  jwk ??= (await googleKeys(fetcher, now, true)).find((k) => k.kid === header.kid);
  if (!jwk) throw fail.invalid('Unknown signing key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64Url(parts[2]), signed))) throw fail.invalid('Bad token signature');
  const nowS = now / MS_PER_S;
  if (!ISSUERS.has(String(claims.iss))) throw fail.invalid('Token is not from Google');
  if (claims.aud !== clientId) throw fail.invalid('Token is for another app');
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < nowS) throw fail.invalid('Sign-in expired, try again');
  if (typeof claims.iat === 'number' && claims.iat - SKEW_S > nowS) throw fail.invalid('Token from the future');
  if (nonce !== null && claims.nonce !== nonce) throw fail.invalid('Sign-in window expired, open it again');
  if (typeof claims.sub !== 'string' || !claims.sub) throw fail.invalid('Token has no account');
  if (claims.email_verified !== true || typeof claims.email !== 'string') throw fail.forbidden('The Google account has no verified email');
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name : claims.email.split('@')[0];
  return { subject: claims.sub, email: claims.email.toLowerCase(), name };
}
