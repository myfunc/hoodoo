# Hoodoo Cloud

Sign in with Google, keep your scenes (animation included) in the cloud, publish
them to a public Gallery, like or dislike other people's posts, report bad ones;
moderators hide, unhide and delete. It is the **Cloud** preview feature: off until
switched on in View › Preview Features (or `?flags=cloud` for one visit), so the
public site works as before.

## Owner setup: Google sign-in

1. Open <https://console.cloud.google.com/apis/credentials>, Create credentials › OAuth client ID (set up the consent screen first if asked: External, app name Hoodoo).
2. Application type: **Web application**, name: Hoodoo.
3. Authorised JavaScript origins: `https://hoodoo.myfunc.io` and `http://localhost:5754`. No redirect URIs.
4. Copy the Client ID into `wrangler.jsonc` › `vars.GOOGLE_CLIENT_ID` (it is public) and release with `npm run deploy`.
5. Until then the app shows "Cloud sign-in is not configured"; the Gallery still lists.
6. The consent screen needs a home page, `privacy.html` and `terms.html` (in `public/`) before it can leave Testing; only the basic `openid email profile` scopes are used, so no verification is needed.

The public instance uses Google Cloud project `hoodoo-511421`.

## How it is built

- **Worker** (`worker/`, TypeScript): the same Cloudflare Worker that serves the site.
  `wrangler.jsonc` runs it only for `/api/*` (`assets.run_worker_first`); every other
  path is `dist/` with `public/_headers`, exactly as before.
- **D1** `hoodoo-cloud`: users, sessions, projects, posts, votes, reports, rate limits.
  Schema in `migrations/` (`npx wrangler d1 migrations apply hoodoo-cloud --remote`).
- **Files**: scenes (gzipped `.hoodoo` JSON, packed in the browser) and JPEG pictures in
  KV `hoodoo-cloud-files` (binding `FILES_KV`). R2 is preferred once it is enabled on the
  account: add an `r2_buckets` binding `FILES` (bucket `hoodoo-cloud-files`); new files go
  to R2 and old ones stay readable from KV. Keys are never reused, so KV's eventual
  consistency cannot serve a stale scene.
- **Sign-in**: File › Cloud Account… opens `/api/auth/signin` as a pop-up. Google's button
  returns an ID token; the Worker checks its RS256 signature against Google's keys, the
  issuer, `aud` = our client ID, expiry, a verified email and the page's nonce, then sets
  `__Host-hoodoo-session` (random token, HttpOnly, Secure, SameSite=Lax, 30 days). D1 keeps
  only the token's SHA-256, so no signing secret exists to leak. The pop-up tells the editor
  over a BroadcastChannel and closes.
- **Anti-bot**: Cloudflare Turnstile (widget `hoodoo-cloud`, managed mode). Publishing,
  voting and reporting need a session that passed it in the last 30 minutes; the API
  answers 428 and the editor shows the check in a frame of `/api/human`, then retries.
  Per-user limits in D1: 60 saves an hour, 10 posts a day, 300 votes an hour, 20 reports a
  day, 30 sign-ins an hour per address.
- **Moderation**: moderators are the emails in the `MODERATORS` secret (comma-separated).
  Posts go live at once; a hidden post is seen only by its author and moderators.
- **Security**: changes (`POST`, `PUT`, `DELETE`) must carry the editor's own `Origin`.
  The editor still loads no outside script: Google's and Cloudflare's scripts run only on
  the two Worker pages, each with its own policy. The editor's policy adds
  `frame-src 'self'` for the check, and its service worker never touches `/api/`.

Limits: scene 2 MB packed and 20 MB unpacked, JPEG picture exactly 480×300 and at
most 500 KB, names 80 characters, 200 projects per user. Each user has 50 MB total
for projects and posts, counting packed scenes and pictures. Replacing a project
releases its old size; deletion releases space. `storage-full` says "Your cloud is
full (50 MB): delete old projects". Migration `0002_cloud_safety.sql` adds picture
sizes and a transactional account counter with quota guards; existing pictures
count as 500 KB until replaced because their size was not recorded previously.

Uploads need a valid Content-Length and a bounded multipart body. The Worker
streams gzip decompression with an unpacked cap, parses JSON and checks the
`hoodoo-scene` envelope, supported version and `scene.objects` array. The editor
still performs full scene validation on opening. Pictures need a JPEG frame of
the expected dimensions and a complete scan. Turnstile success must name the
request hostname.

The Gallery queries public posts through `posts_new` or `posts_top`. A signed-in
author's hidden posts are fetched separately through `posts_owner_hidden` and
merged into the same page, so the author still sees the hidden badge. Each list
has independent pagination; a signed-in page can include up to 24 public and 24
own hidden posts.

A moderator can set a hide reason of at most 200 characters. `hiddenReason` is
returned only to the author and moderators; moderation rows also include
`authorId`. Authors cannot delete hidden posts while awaiting review. Three
distinct reporters of any reason, or two distinct `illegal` reporters, hide a
post automatically with "Hidden after reports, waiting for a moderator". Repeat
reports update the same reporter's row. Clearing reports does not unhide a post;
unhiding clears its hide reason.

Account deletion removes every owned project's and post's file prefix from both
R2 and KV, including obsolete versions, then cascades the account's projects,
posts, votes, reports and sessions, removes its rate rows and recounts affected
posts from other authors. The session cookie is cleared. Once deletion starts,
new mutations are refused; a file-store failure leaves the account available for
retrying DELETE /api/me. Large accounts use batches of three owned entries per
request to fit the Free Worker's subrequest budget: 202 `{ deleting: true }`
means repeat the same DELETE; the browser's `deleteAccount()` does so until the
final 204 clears the cookie. Account deletion also removes hidden posts.

A daily Cron Trigger (03:17 UTC) purges expired sessions and rate rows after one
full day, keeping IP-address rate rows for at most two days between daily runs.
Sessions expire after 30 days. IP-only rate rows are not linked to an account.
Failed uploads clean up new files immediately; account deletion sweeps its file
prefixes. There is no global orphan sweep: legacy KV keys have no creation time,
so a scan cannot safely distinguish a new in-flight upload from an orphan at a
bounded cost. Daily D1/KV quota failures return `busy` (503): "Hoodoo Cloud is busy
today, try again tomorrow".

## API

All JSON unless noted; errors are `{ "error": code, "message": text }` with the codes in
`src/io/cloud/cloud-contract.ts`. Uploads are multipart: `name`, `scene` (gzip), `thumb` (JPEG, optional).

| Method and path | Who | What |
| --- | --- | --- |
| `GET /api/config` | anyone | `{ googleClientId, turnstileSiteKey, devLogin }` |
| `GET /api/me` | anyone | `{ user }` or `{ user: null }` |
| `DELETE /api/me` | user | deletes the account, owned files and all linked data, clears cookie |
| `GET /api/auth/signin` | anyone | the sign-in pop-up (HTML) |
| `POST /api/auth/google` | anyone | `{ credential }` → session cookie, `{ user }` |
| `POST /api/auth/dev` | localhost with `DEV_LOGIN=1` | `{ email, name }` → session cookie |
| `POST /api/auth/signout` | user | ends the session |
| `GET /api/human`, `POST /api/human` | user | the Turnstile frame; `{ token }` → human for 30 min |
| `GET /api/projects` | user | own projects, newest first |
| `POST /api/projects`, `PUT /api/projects/:id` | user | save new, replace own |
| `GET /api/projects/:id/scene`, `/thumb` | owner | the packed scene, the picture |
| `DELETE /api/projects/:id` | owner | delete |
| `GET /api/posts?sort=new\|top&page=n` | anyone | gallery page `{ posts, more }` |
| `POST /api/posts` | user, human | publish |
| `GET /api/posts/:id/scene`, `/thumb` | anyone (hidden: author, moderators) | open a copy, the picture |
| `POST /api/posts/:id/vote` | user, human | `{ value: 1 \| -1 \| 0 }`, not on one's own post |
| `POST /api/posts/:id/report` | user, human | `{ reason: spam \| offensive \| broken \| other \| illegal, note }` |
| `DELETE /api/posts/:id` | author (visible posts), moderator | delete with votes, reports, files |
| `POST /api/posts/:id/hide` | moderator | `{ hidden: true \| false, reason?: string }` |
| `POST /api/posts/:id/clear-reports` | moderator | clears the reports |
| `GET /api/mod/posts?filter=reported\|hidden` | moderator | the queue, with report notes, authorId and hiddenReason |

## Local testing without Google

```sh
cp .dev.vars.example .dev.vars                          # DEV_LOGIN=1, Turnstile test keys
npx wrangler d1 migrations apply hoodoo-cloud --local
npx wrangler dev                                        # API on http://localhost:8787
npx vite --port 5754                                    # the editor; /api goes to 8787
```

Open <http://localhost:5754/?flags=cloud>, File › Cloud Account…, Sign in: the pop-up has a
dev form (any email; an email listed in `MODERATORS` is a moderator). The dev sign-in
works only with `DEV_LOGIN=1` **and** a localhost address; production has neither.
Tests: `npx vitest run worker src/io/cloud` (the Worker runs against the real schema in
`node:sqlite`); types: `npx tsc --noEmit -p worker`.
