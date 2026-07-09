# Adapting this to YOUR setup

This uploader assumes a specific shape (a Notion creative board, Frame.io folders, a builder + testing
campaign, a `var:N` naming token). Yours is probably ~90% the same. Here are the **only 5 places** that
change per setup — everything else stays. If you're using the AI co-pilot (`CLAUDE.md`), it will walk you
through these against your real accounts.

---

## 1. Notion columns → what the uploader reads
**Where:** the n8n workflow's **`Extract + Guard`** Code node.
**What it does:** reads your concept row's properties *by column name* and hands them to the uploader.

Out of the box it expects these columns (rename the references to match yours):

| Uploader input | Default column | Type | Notes |
|---|---|---|---|
| Identity | `Identity` | Select | value must match a key in the config `identities` map |
| Creative link | `Output Link` | URL | the Frame.io **concept folder** link (holds the variation files) |
| Ad name | `Ad Name` | Formula/Text | should contain a `var:N` token (see #4) |
| Ad set name | `Adset Name` | Formula/Text | |
| Primary text | `Primary Text` | Text | `<br>` is converted to newlines |
| Headline | `Headline` | Text | |
| Destination URL | `Target URL` | URL | |
| Variation count | `Variations` | Number | how many variations to expect |
| Control | `Upload Status` / `Upload Log` / `Created IDs` | Select / Text / Text | the workflow writes these back |

**To adapt:** open the `Extract + Guard` node and change each column name to yours. (Tip: pull all names
into a `FIELD = { ... }` object at the top of the node so it's one edit.) See `NOTION-BOARD.md` for the
canonical board.

---

## 2. Frame.io organization → how variations are found
**Where:** `api/_meta-uploader-config.js` → `variationRegex`, and `api/prepare-media.js` → `frameioListFiles`.
**Default assumption:** one **flat** Frame.io folder per concept, containing the N variation files, named
so a number can be read out (e.g. `..._Var 1.mp4`, `V2.mov`). Version stacks (re-uploaded clips) are handled
automatically.

**To adapt:**
- Different filename pattern → tune `variationRegex` (it captures the variation number).
- **One subfolder per variation** instead of a flat folder → a small change in `frameioListFiles` to recurse
  into subfolders (or treat each subfolder as a variation). The AI co-pilot can make this after seeing one
  of your real folders.

---

## 3. Campaigns, budget, targeting → config values
**Where:** `api/_meta-uploader-config.js`.
All pure config: `BUILDER_CAMPAIGN_ID`, `TESTING_CAMPAIGN_ID`, `adSetDefaults` (budget, geo, optimization
goal, billing, bid strategy, attribution, `promoted_object` pixel + event), `defaultCallToAction`, `urlTags`.
Create your two campaigns once in Ads Manager, paste their IDs, tune the ad-set defaults to your account.

---

## 4. Naming convention → the per-variation token
**Where:** `variationRegex` in config, and `perVariationAdName` in `api/build-concept.js`.
**Default:** each variation's ad name is the base Ad Name with its `var:N` token swapped to that variation's
number (so `..._var:1_...` → `..._var:2_...`). If your names carry the variation number differently, adjust
the regex and the substitution. If you don't use a per-variation token at all, the base name is used as-is.

---

## 5. Identities → your Pages + Instagram accounts
**Where:** `identities` in `api/_meta-uploader-config.js`.
Map each Notion `Identity` value → `{ page_id, instagram_user_id }`. For your own brand, that's your Page +
IG. For **whitelisting/partner** pages, add an entry AND make sure your Business system user has **Advertise**
access on that partner Page (Business Settings → Pages → assign partner/People). Missing either id fails
loudly (it won't post under the wrong Page).

---

## What does NOT change
The core method is fixed (and is the whole value): create the page post **once** per variation via
`object_story_spec`, then only ever reference it by `object_story_id` so builder + testing ads **share
engagement**; everything is created **paused**; long videos are handled via the parallel-upload +
readiness-loop; batches auto-space via n8n concurrency. You shouldn't need to touch any of that.

If your process is *fundamentally* different (no builder/testing split, creative not in Frame.io, no Notion
board), this becomes a rebuild rather than an adapt — still doable with the AI, just more than config.
