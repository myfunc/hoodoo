# Hoodoo Cloud

Sign in with Google to publish scenes (animation included) to the public Gallery,
like or dislike posts and report bad ones. Moderators hide, unhide and delete.
Hoodoo Cloud stores public posts only. Projects belong on your device or in your
own cloud; the editor saves them there. The **Cloud** preview feature is enabled
in View › Preview Features, or with `?flags=cloud` for one visit.

## Owner setup: Google sign-in

1. Open <https://console.cloud.google.com/apis/credentials>, Create credentials › OAuth client ID (set up the consent screen first if asked: External, app name Hoodoo).
2. Application type: **Web application**, name: Hoodoo.
3. Authorised JavaScript origins: `https://hoodoo.myfunc.io` and `http://localhost:5754`. No redirect URIs.
4. Copy the Client ID into `wrangler.jsonc` › `vars.GOOGLE_CLIENT_ID` (it is public) and release with `npm run deploy`.
5. Until then the app shows "Cloud sign-in is not configured"; the Gallery still lists.
6. The consent screen needs a home page, `privacy.html` and `terms.html` (in `public/`) before it can leave Testing; only the basic `openid email profile` scopes are used, so no verification is needed.

The public instance uses Google Cloud project `hoodoo-511421`.

## Storage, identity and limits

The TypeScript Worker in `worker/` serves `/api/*`; other paths are static assets
from `dist/`, with `public/_headers`. D1 `hoodoo-cloud` holds users, sessions,
posts, votes, reports, rate limits and one `meta` row. Migration
`0003_public_gallery.sql` drops private projects and their triggers/indexes,
drops users' email/name columns, and gives existing accounts a NULL nick. It adds
case-insensitive nick uniqueness, gallery versioning and total storage accounting.

Users retain a generated account id, Google's stable subject id, a nickname and
lowercased `nick_key`, moderator flag, creation time, storage bytes and deletion
flag. Email is used only in memory after token verification to compare against
`MODERATORS` (comma-separated secret). Every sign-in updates the stored boolean;
email and Google name are never written to D1, shown to clients or logged.
Sign-in preserves an existing nick. Nicknames are 3–20 ASCII letters/digits/_/-,
starting and ending with a letter or digit. Uniqueness and reserved words are
case-insensitive. Reserved: admin, administrator, mod, moderator, hoodoo,
support, staff, system, official, root, null, undefined, anonymous.

Google tokens need an RS256 signature, matching issuer/audience, valid expiry,
verified email and the sign-in page's nonce. The session cookie
`__Host-hoodoo-session` is random, HttpOnly, Secure, SameSite=Lax, valid for 30
days; D1 stores its SHA-256 only. The sign-in page tells the editor over a
BroadcastChannel. Mutations need the editor's own `Origin` (plus configured
`APP_ORIGINS` for local development). Google and Turnstile scripts run in their
own Worker pages with separate policies; the service worker skips `/api/`.

Publishing, voting and reporting require a nickname **before** Turnstile/rate
checks, then a human check valid for 30 minutes. Turnstile success must name the
request hostname. Limits: 10 posts/day, 300 votes/hour, 20 reports/day per user;
Google sign-in 30/hour per IP. A daily 03:17 UTC Cron purges expired sessions and
rate rows older than one day: IP rows survive at most two days between runs.
IP-only rows are not linked to an account.

Scene files are gzipped `.hoodoo` JSON; pictures are JPEG. New files go to the R2
bucket `hoodoo-cloud-files` (binding `FILES`); reads fall back to `FILES_KV`, where
files saved before R2 stay. Without an R2 binding, writes use KV. Immutable random
file keys are never reused.

Limits (`CLOUD_LIMITS`): 2 MB packed / 20 MB unpacked scene, picture exactly
480×300 and at most 500 KB, title 80 characters. Each user has 50 MB for posts
(including hidden posts), and the entire Gallery has **10 GB = 10 × 1024³ bytes**.
Counters `users.storage_bytes` and `meta.stored_bytes` count scenes plus pictures.
SQL insert/delete triggers change counters atomically and reject racing uploads
at either cap. Deletion releases space. `storage-full` (413) says "Your Gallery
storage is full (50 MB): delete old posts". `cloud_full` (503) says "The Gallery
is full for now: try again later". D1/KV daily quota errors use `busy` (503).

Uploads need a valid Content-Length and a bounded multipart body. The Worker
streams gzip decompression with a cap, parses JSON and checks the `hoodoo-scene`
envelope, supported version and `scene.objects`. The editor performs full scene
validation on opening. JPEG validation checks dimensions and a complete scan.
Failed row writes clean the new files immediately. There is no global orphan
sweep: legacy KV keys have no creation time to safely distinguish in-flight files.

## Costs

Cloudflare has no hard spending cap, so the Worker keeps every paid service inside
its free allowance by design (prices of 2026-10):

| Service | Free a month | Bound in the code | Worst case |
|---|---|---|---|
| R2 storage | 10 GB | `meta.stored_bytes` ≤ 10 GB (triggers) | $0 |
| R2 writes (Class A) | 1M | 1000 posts a day on the whole cloud (`CLOUD_POSTS_PER_DAY`), 2 writes each | ~62k, $0 |
| R2 reads (Class B) | 10M | one read per Worker request; Workers Free stops at 100k requests a day | ~3.1M, $0 |
| R2 egress | free | | $0 |
| Workers, D1, KV on Free | daily limits | requests past them fail, nothing is billed | $0 |

Past the daily post budget, publishing answers `busy` (503) "Hoodoo Cloud is busy
today, try again tomorrow" until 00:00 UTC. The bound on reads holds only on
Workers Free: on Workers Paid requests are billed past 10M a month, and the R2
reads would need their own counter. Spending alerts are set by hand in the
dashboard: Notifications › Add › Usage Based Billing.

## Gallery caching and moderation

`GET /api/posts` never reads a session, includes no per-user fields, and lists
only visible posts through `posts_new` / `posts_top`. A cheap read of the single
`meta.gallery_version` row precedes a Workers Cache API lookup keyed by canonical
sort, page and version. Cached JSON is identical for anonymous users, authors and
moderators. Edge entries live for one day; response headers are
`Cache-Control: public, max-age=0, must-revalidate` and
`ETag: "<version>-<sort>-<page>"`. Matching `If-None-Match` returns a bodyless 304,
including weak tags, comma-separated tags and `*`.

Database triggers bump the version in the **same transaction** when publish,
delete, hide/unhide, auto-hide, vote counts/Top order, author nick changes or
account deletion alter the public list. Reports and clearing reports are private
and do not bump it unless a visibility change occurs. Repeating an unchanged
vote/hide does not bump it. Hidden-only changes do not affect public pages.

`GET /api/me/posts-state?ids=...` provides ownership/votes for at most 48 requested
ids, uncached. Hidden posts inaccessible to the caller are omitted. Own posts,
including hidden ones, come from `GET /api/me/posts?page=n`, uncached and newest
first. All lists page independently at 24 entries (page 0–100).

Public thumbs use the Cache API with an immutable file-version URL and
`Cache-Control: public, max-age=3600`. Every file request checks the post's current
visibility in D1 **before** any cache hit. Hidden thumbs bypass cache and use
`no-store`; hidden scenes also use `no-store`. Hidden files are available only to
the author/moderators. Hide, auto-hide, deletion and account deletion evict the
thumb/scene URLs locally; the D1 check protects other edge locations too. Scenes
are always uncached.

Moderator rows show only the author's nickname and generated `authorId`, never
Google identity claims. Hide reasons (≤200 characters) are returned only to the
author/moderators. Authors cannot delete hidden posts while awaiting review.
Three distinct reporters of any reason, or two distinct `illegal` reporters,
auto-hide with "Hidden after reports, waiting for a moderator". Repeat reports
update one row. Clearing reports does not unhide; unhiding clears the reason.
Illegal content, copyright and privacy requests can also be sent to
[hoodoo@myfunc.io](mailto:hoodoo@myfunc.io), without an account.

Account deletion removes all owned post file prefixes from R2 and KV, including
obsolete files, then cascades posts, votes, reports and sessions, removes user
rate rows and recounts votes/reports on other authors' posts. It also removes
hidden posts. New mutations are refused once deletion starts. File failure
leaves an authenticated account to retry. Bounded batches of three posts fit
Worker subrequest budgets: repeat DELETE while it returns 202
`{ deleting: true }`; final 204 clears the cookie. `CloudApi.deleteAccount()`
handles this loop. IP-only rate rows remain until their normal expiry.

## API

Errors: `{ error: code, message: text }`. JSON and private routes use `no-store`
except the shared Gallery list/public thumbs. Changes need Origin. `User` is
`{ id: string, nick: string|null, moderator: boolean }`.

Shared `Post`: `{ id, title, author: nick, createdAt, likes, dislikes, hidden,
thumb: string|null }`. `hidden` is always false in the public list. No `mine` or
`myVote` exists in any Post: obtain them from posts-state. Owner responses add
`hiddenReason: string|null`; moderator responses additionally add `authorId`,
`reports`, `reportNotes: [{ reason, note, at }]`. Public rows have none of these
private fields. `PostPage` is `{ posts: Post[], more: boolean }`.

| Method and path | Who | Request → response |
| --- | --- | --- |
| `GET /api/config` | anyone | `{ googleClientId, turnstileSiteKey, devLogin }` |
| `GET /api/me` | anyone | `{ user: User|null }` |
| `PUT /api/me/nick` | user | `{ nick }` → `{ user: User }` |
| `GET /api/me/posts-state?ids=a,b,c` | user | `{ mine: string[], votes: { [id]: 1\|-1 } }`; missing/zero votes omitted, ≤48 ids |
| `GET /api/me/posts?page=n` | user | own `PostPage`, including hiddenReason/hidden posts |
| `DELETE /api/me` | user | 202 `{ deleting: true }` until final 204; cookie cleared |
| `GET /api/auth/signin` | anyone | sign-in HTML |
| `POST /api/auth/google` | anyone | `{ credential }` → `{ user: User }`, session cookie |
| `POST /api/auth/dev` | localhost with `DEV_LOGIN=1` | `{ email }` → `{ user: User }`, cookie; test subject is a hash, no raw email persisted |
| `POST /api/auth/signout` | anyone | `{ user: null }`, cookie cleared |
| `GET /api/human` | anyone | Turnstile HTML frame |
| `POST /api/human` | user | `{ token }` → `{ humanUntil }` (Unix ms) |
| `GET /api/posts?sort=new\|top&page=n` | anyone | shared `PostPage`; 200 or 304 |
| `POST /api/posts` | user, nick, human | multipart `name`, `scene` (gzip), optional `thumb` (JPEG) → 201 `{ post }` |
| `GET /api/posts/:id/scene`, `/thumb` | anyone; hidden: owner/mod | gzip scene / JPEG |
| `POST /api/posts/:id/vote` | user, nick, human | `{ value: 1\|-1\|0 }` → `{ post }`; cannot vote for one's own post |
| `POST /api/posts/:id/report` | user, nick, human | `{ reason: spam\|offensive\|broken\|other\|illegal, note?: string }` → 204 |
| `DELETE /api/posts/:id` | author (visible), moderator | 204 after votes/reports/files deleted |
| `POST /api/posts/:id/hide` | moderator | `{ hidden: boolean, reason?: string }` → `{ post }` |
| `POST /api/posts/:id/clear-reports` | moderator | no body → `{ post }` |
| `GET /api/mod/posts?filter=reported\|hidden&page=n` | moderator | moderator `PostPage` |

All former `/api/projects*` routes return 404; the client no longer exposes
CloudProject or projects/saveProject/openProject/deleteProject.

New errors: `nick_required` **428**, `nick_invalid` **400**, `nick_reserved`
**400**, `nick_taken` **409**, `cloud_full` **503**. For `nick_required`, open the
nickname form, call PUT /me/nick, then retry the original operation. `human`
**428** separately requests Turnstile. Existing codes: `sign-in` 401,
`forbidden` 403, `not-found` 404, `invalid` 400, `too-large`/`storage-full` 413,
`too-many` 429, `busy`/`not-configured` 503, `server` 500.

Client methods: `setNick(nick): Promise<CloudUser>`,
`postsState(ids): Promise<PostsState>`, `ownPosts(page=0): Promise<PostPage>`.
`posts`, `publish`, `vote`, `report`, `hide`, `clearReports`, `deletePost`,
`openPost` keep their routes, with the new shared Post contract.

## Local testing without Google

Use `.dev.vars.example` for a local `.dev.vars` (DEV_LOGIN=1, Turnstile test keys).
The dev login accepts an email in memory to identify a repeat test account and
compute the moderator flag; it stores only its hashed test subject. It works
only with `DEV_LOGIN=1` and localhost; production has neither.

```sh
npx wrangler d1 migrations apply hoodoo-cloud --local --persist-to /tmp/hoodoo-public-state
npx wrangler dev --port 8789 --persist-to /tmp/hoodoo-public-state
npx tsc --noEmit -p worker
npx vitest run worker src/io/cloud
```

Local API: <http://localhost:8789/api/config>. Sign in, then set a nick before
publishing, voting or reporting. For the editor on Vite 5754, configure its API
proxy to the desired local Worker port and allow its origin via APP_ORIGINS.
