# Setup guide

The same steps the AI co-pilot walks you through (`CLAUDE.md`), written out. Order matters — Meta first
(it's the longest), then Frame.io, then deploy, then wire up n8n + Notion, then test.

> Time: ~1–2 hours of hands-on, plus a few days *waiting* if you request the Standard API tier.
> Everything created on Meta is **paused** — nothing spends until you launch.

## Architecture
```
Notion row  --click "Upload to Meta"-->  n8n webhook
   n8n:  read row -> prepare-media (Frame.io -> Meta upload) -> check-media loop (wait for processing)
         -> build-concept (create paused ads, sharing one post id per variation) -> write Done/Error
   Vercel hosts prepare-media / check-media / build-concept.
```

## Prerequisites (accounts)
- **Meta**: a Business portfolio, a Facebook Page + linked Instagram, an ad account with active billing.
- **Frame.io** (V4) with your creative, and an **Adobe Developer Console** login (to make an OAuth app).
- **Vercel** account (Pro recommended — building 4 variations can exceed the 60s free-tier function limit).
- **n8n** account (Cloud **Starter** is enough) — or self-hosted.
- **Notion** with a creative board (see `NOTION-BOARD.md`).
- A machine with **Node 18+** and **git** (for deploying + the Frame.io token step).

---

## Step 1 — Meta app, token, pixel, campaigns

1. **Meta app** — at [developers.facebook.com/apps](https://developers.facebook.com/apps) create an app
   (type: Business). Add the **Marketing API** product. Set a Privacy Policy URL + Category and flip the app
   to **Live** (Development mode blocks creative creation).
2. **System user + token** — in **Business Settings → Users → System Users**, create a system user, assign
   it to your **ad account** (Manage) and your **Page(s)** (with **Advertise/Manage**), then **Generate a
   token** for your app with scopes: **`ads_management`**, **`pages_manage_ads`** (and `business_management`).
   Choose a non-expiring token. Put it in `.env` / Vercel as `META_ACCESS_TOKEN`.
   - A read-only token gives **error 100 / subcode 33** on the first write. That means the scopes/roles above
     aren't fully set.
3. **Pixel** — note your Pixel id (Events Manager) and the conversion event (e.g. `PURCHASE`).
4. **Two campaigns** — in Ads Manager create, once:
   - a **builder** campaign (leave it OFF / "Do Not Turn On" — it only exists to create the page posts), and
   - your **testing** campaign.
   Note both campaign ids.
5. *(Recommended)* **Standard API tier** — the default **Development** Marketing API tier has low rate limits
   (a burst throws error `#4`). Request the upgrade under **App Dashboard → App Review → Permissions and
   Features → Marketing API Access Tier → Upgrade**. Needs ~500 API calls in 15 days + <15% error rate and
   business verification; approval takes a few days. You can start on Development and upgrade later.
6. *(Optional)* **Whitelisting partners** — to run ads AS a partner's Page, get **Advertise** access to their
   Page for your system user (Business Settings → Pages → assign partner). Then add them to the `identities`
   map.

## Step 2 — Collect your IDs
You'll paste these into `api/_meta-uploader-config.js`:
- `AD_ACCOUNT_ID` — `act_<number>` (Ads Manager / Business Settings).
- `BUILDER_CAMPAIGN_ID`, `TESTING_CAMPAIGN_ID` — from the campaigns you made.
- `pixel_id` — Events Manager.
- Each identity's `page_id` — Business Settings → Pages.
- Each identity's `instagram_user_id` — get it via the API (with your token):
  `GET /v22.0/<page_id>?fields=connected_instagram_account,instagram_accounts&access_token=<token>`
  (use the returned IG **user id**, not the `@handle`).

## Step 3 — Frame.io API access (Adobe IMS OAuth)
Frame.io V4 uses Adobe IMS OAuth. You need a **refresh token** (long-lived; the functions mint short-lived
access tokens from it at runtime).

1. At [developer.adobe.com/console](https://developer.adobe.com/console), create a project → add an
   **OAuth Web App** credential. Note the **Client ID** and **Client Secret**. Add a redirect URI, e.g.
   `https://localhost:9090/callback`. Scopes: `email, openid, profile, additional_info.roles, offline_access`
   (`offline_access` is required to get a refresh token).
2. **Authorize once** to get a refresh token:
   - Open: `https://ims-na1.adobelogin.com/ims/authorize/v2?client_id=<CLIENT_ID>&scope=email%2Copenid%2Cprofile%2Cadditional_info.roles%2Coffline_access&redirect_uri=https%3A%2F%2Flocalhost%3A9090%2Fcallback&response_type=code`
   - Log in, approve. Your browser redirects to `https://localhost:9090/callback?code=…` (it'll show a
     connection error — that's fine). Copy the `code` from the address bar.
   - Exchange it for tokens (replace values):
     `POST https://ims-na1.adobelogin.com/ims/token/v3` (form-encoded) with
     `grant_type=authorization_code, client_id, client_secret, code, redirect_uri`. The response's
     **`refresh_token`** is what you keep.
   - *(The AI co-pilot can run a tiny local HTTPS listener on :9090 and do this exchange for you.)*
3. **Account id** — your Frame.io V4 account id (from the Frame.io URL / API). Set `FRAMEIO_ACCOUNT_ID`.
4. Put `FRAMEIO_CLIENT_ID`, `FRAMEIO_CLIENT_SECRET`, `FRAMEIO_REFRESH_TOKEN`, `FRAMEIO_ACCOUNT_ID` in `.env`
   / Vercel.
   - Note: Adobe refresh tokens expire ~every 30 days — re-run this authorize step when Frame.io auth starts
     failing with `access_denied` (or move to an Adobe server-to-server credential for a durable fix).

## Step 4 — Deploy to Vercel
1. Fork/clone this repo. `cd` in and `npm i -g vercel` (if needed).
2. In `api/`, copy `_meta-uploader-config.example.js` → `_meta-uploader-config.js` and fill it in (Step 5).
3. `vercel link` (create a project), then set the env vars from `.env.example` in **Vercel → Settings →
   Environment Variables (Production)**: `META_ACCESS_TOKEN`, `FRAMEIO_CLIENT_ID`, `FRAMEIO_CLIENT_SECRET`,
   `FRAMEIO_REFRESH_TOKEN`, `FRAMEIO_ACCOUNT_ID`.
4. `vercel --prod`. Note your base URL, e.g. `https://<project>.vercel.app`. Your endpoints are
   `/api/prepare-media`, `/api/check-media`, `/api/build-concept`.
5. Quick check (should return JSON, not 404): `curl -X POST https://<project>.vercel.app/api/check-media
   -H 'content-type: application/json' -d '{"videoIds":["0"]}'`.

## Step 5 — Fill the config
Edit `api/_meta-uploader-config.js` (from the example): ad account, campaign ids, budget, geo, pixel, CTA,
the `identities` map, and `FRAMEIO_ACCOUNT_ID`. See `ADAPTING.md` for what each seam means. Re-deploy
(`vercel --prod`) after edits.

## Step 6 — Notion board
Follow **`NOTION-BOARD.md`**: create/confirm the columns, add the control columns, and add the **Upload to
Meta** button pointing at your n8n webhook (Step 7 gives you the URL).

## Step 7 — Import + wire the n8n workflow
1. In n8n: **Workflows → Import from File** → `n8n-workflow.json`.
2. **Re-link the Notion credential** — create a Notion internal integration (with access to your board's
   database) and select it on the `Read Page`, `Set Uploading`, `Write Done`, `Write Error …` nodes.
3. **Point it at your Vercel URL** — in the `Parse Trigger` node set `prepareUrl` / `buildUrl` to your
   `https://<project>.vercel.app/api/...`, and set the `Check Media` node's URL to your `.../api/check-media`.
4. **Field map** — open `Extract + Guard` and change the column names to match your board (see `ADAPTING.md`
   #1).
5. **Activate** the workflow. Copy its production **Webhook URL** into the Notion button (Step 6).

## Step 8 — First test (do this on ONE real concept)
Pick one ready concept (files in its Frame.io folder, identity set, target URL). Click **Upload to Meta**.
Watch the row: `Uploading → Done`. Then verify in Ads Manager:
- Builder campaign: one ad set per variation, each with a **new-post ad + existing-post ad** (2 ads), paused.
- The existing-post ad's `object_story_id` **equals** the new-post ad's `effective_object_story_id`
  (shared-engagement proof).
- Testing campaign: one ad set with the existing-post variants, referencing the same post ids.
- Enhancements, targeting, pixel, budget, names all per your config.
Fix any mismatch (usually a field-map or config value), re-run, and you're live.

> New objects sit in `PENDING_REVIEW` and are hidden from default list queries — look them up with
> `effective_status=[...all statuses...]` if you can't find them.

---

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| Write calls fail **100 / 33** | Token missing `ads_management`/`pages_manage_ads`, or system user lacks ad-account/Page access. |
| Creative create fails **100 / 1885183** | App still in **Development** mode → set it Live. |
| `#4 Application request limit reached` | Development rate tier or a big burst → request Standard tier; don't fire huge batches at once. |
| Frame.io `access_denied` | Refresh token expired (~30-day Adobe cap) → re-run Step 3's authorize. |
| Row: "videos still processing" / timeout | Handled here (parallel upload + n8n readiness loop). If you see it, a video may genuinely be failing to process, or exceeds 4 GB / 241 min. |
| Whitelisted ad: "access to ads required for this Page" | Your *personal* account view; the system user still publishes fine. Grant your user Page access to edit in the UI. |
| Variation count mismatch | The Frame.io folder file count ≠ the `Variations` number, or a re-uploaded clip became a version stack (handled) — confirm the folder. |

## Operating notes
- **One-shot post rule** — the page post is created once via `object_story_spec`, then only referenced by
  `object_story_id`. Never edit it (that forks a new post and zeroes engagement).
- **Batches** auto-space: n8n runs a few concepts at a time and queues the rest, so you can click many.
- **Pin the Graph API version** (`GRAPH_VERSION` in config); upgrade deliberately and re-verify the
  enhancement key list (Advantage+ keys shift between versions).
