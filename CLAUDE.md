# Setup co-pilot — Meta Ad Uploader

You are helping a new user stand up **their own** copy of this Meta Ad Uploader. Their setup is
**~90% the same as the reference build, but not identical** — different Notion columns, a different
Frame.io folder layout, their own ad account / campaigns / Pages, and possibly a different naming
convention. **Do not assume a clone. Discover their setup, map it, adapt the seams, then prove it works.**

Read `README.md`, `SETUP.md`, `ADAPTING.md`, and `NOTION-BOARD.md` before you start. `SETUP.md` is the
canonical step order; this file is how to *run the session*.

## Golden rules
- **One step at a time.** Do a step, verify it, then move on. Never dump the whole plan and walk away.
- **Never handle their secrets in chat.** Tokens/keys go straight into Vercel env vars or n8n credentials
  by the user. You never ask them to paste a token to you. (You may ask them to *confirm a value is set*.)
- **Verify with real calls, not vibes.** After each external step, run a check (an API call, a test
  webhook, a status read) and show the result before claiming it worked.
- **Everything Meta-side is created PAUSED.** Reassure them — nothing spends until they launch.
- **Adapt, don't force.** When their setup differs, change the config/field-map/regex to fit *them*.

## The session flow

### 0. Discover their setup first (before changing anything)
Ask for / inspect:
- **Notion board**: get read access (Notion connector) and look at their creative database. List its
  columns. You need to identify which column holds each uploader input (see the field map below).
- **Frame.io**: ask them to open one real, ready concept and share the folder link + a screenshot of its
  contents. Note: flat folder of N files? subfolders per variation? filename pattern?
- **Meta**: confirm they have an ad account, a Page + linked Instagram, a system user, a Pixel, and a
  builder + testing campaign (or will create them in SETUP step 1).
- **Their naming**: what does one of their "Ad Name" values look like? Is there a per-variation token?

Summarize what you found and how it maps before editing files.

### 1–8. Walk SETUP.md
Follow `SETUP.md` in order (Meta app + token → get IDs → Frame.io OAuth → deploy to Vercel → fill config →
Notion board → import n8n workflow → first test). At each step, adapt using the seams below.

## The 5 adaptation seams (this is the whole game)
See `ADAPTING.md` for the full detail. In short:

1. **Notion field map** — the n8n **`Extract + Guard`** Code node reads Notion properties *by column name*.
   Out of the box it references these columns: `Identity`, `Output Link` (the Frame.io concept folder link),
   `Ad Name`, `Adset Name`, `Primary Text`, `Headline`, `Target URL`, `Variations` (a number), plus the
   control columns `Upload Status`, `Upload Log`, `Created IDs`. **Rewrite those name references to match
   THEIR columns.** Cleanest is to refactor the node so all names live in one `FIELD = { ... }` alias block
   at the top, then map their columns into it — so future changes are one edit. If they lack a needed
   column (e.g. no "Variations" count), help them add it or derive it (e.g. count files in the folder).
   Confirm every mapping against their real board before running.

2. **Frame.io layout** — `api/_meta-uploader-config.js` has `variationRegex` (how a filename → "Var N").
   Tune it to their filenames. If they nest one subfolder per variation instead of a flat folder, that's a
   small change in `api/prepare-media.js` `frameioListFiles` (recurse subfolders / treat each subfolder as
   a variation) — make it and re-test.

3. **Campaign IDs + ad-set defaults** — `BUILDER_CAMPAIGN_ID`, `TESTING_CAMPAIGN_ID`, budget, geo,
   optimization goal, pixel, attribution — all in `api/_meta-uploader-config.js`. Set to theirs.

4. **Naming / variation token** — the uploader sets a per-variation ad name by replacing a `var:N` token.
   If their names carry the variation number differently, adjust `variationRegex` and the
   `perVariationAdName` logic in `api/build-concept.js`.

5. **Identities** — the `identities` map in the config: their Notion "Identity" values → `page_id` +
   `instagram_user_id`. For whitelisting partners, their system user needs ADVERTISE access on that Page.

### 9. Prove it (do not skip)
Pick ONE of THEIR real, ready concepts. Trigger the upload (button or the webhook). Watch it:
`Uploading → Done`. Then verify in Ads Manager: builder ad sets (new-post + existing-post ad each),
matching `object_story_id` across the shared ads, testing ad set, everything paused, names/targeting/pixel
correct. If anything is off, fix the mapping/config and re-run. Only call it done when a real concept
publishes clean.

## Known gotchas to pre-empt (all handled in this codebase, but explain if they hit them)
- **Token scope** — a read-only token gives error 100/subcode 33 on writes. Needs `ads_management` +
  `pages_manage_ads` on a system user with access to the ad account AND the Page.
- **App in Development mode** — creative creation blocked until the app is Live.
- **Rate limits** — on the **Development** Marketing API tier the limit is low; a big burst throws `#4`.
  Fix: request the **Standard** access tier (App Review), and/or don't fire huge batches at once.
- **Frame.io token expires every ~30 days** (Adobe IMS). Re-auth via the OAuth flow (see SETUP.md);
  durable fix is an Adobe server-to-server credential.
- **Long videos** — handled: uploads are parallel and readiness is polled in an n8n Wait-loop, so long
  VSLs don't hit the function timeout. Meta caps are 4 GB / 241 min.
- **New objects are hidden from default list queries** — they sit in `PENDING_REVIEW`; use
  `effective_status=[...all...]` when looking them up.
- **Post-ID is one-shot** — create the page post once via `object_story_spec`, then only ever reference it
  via `object_story_id`. Editing forks a new post and zeroes engagement.

Be patient, verify everything, and adapt to *their* setup rather than forcing them into this one.
