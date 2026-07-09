# The Notion board

The uploader is triggered from a Notion database where each row is one **creative concept** (with N
variations). You can adapt column names to your existing board — the n8n `Extract + Guard` node maps them
(see `ADAPTING.md`). Below is the canonical shape.

## Required columns

| Column | Type | Purpose |
|---|---|---|
| **Identity** | Select | Which Page/IG to post as. Each option must match a key in the config `identities` map (e.g. `My Brand`, `WL - Partner`). |
| **Output Link** | URL | Link to the concept's **Frame.io folder** that holds the variation files. Use the full `next.frame.io/project/.../<folderId>` link (not a short `f.io/…` share link). |
| **Ad Name** | Formula or Text | The per-variation ad name. Should contain a `var:N` token so the uploader can number each variation (see naming below). |
| **Adset Name** | Formula or Text | The ad set name for the concept. |
| **Primary Text** | Text | The ad body. Literal `<br>` becomes newlines. |
| **Headline** | Text | The ad headline/title. |
| **Target URL** | URL | Destination link for the ad. |
| **Variations** | Number | How many variations this concept has (must match the file count in the Frame.io folder). |

## Control columns (the workflow writes these back)

| Column | Type | Values |
|---|---|---|
| **Upload Status** | Select | `Idle`, `Uploading`, `Done`, `Error` |
| **Upload Log** | Text | Success message or the failure reason |
| **Created IDs** | Text | JSON of the Meta objects created (ad sets, creatives, ads, post ids) |

## The "Upload to Meta" button

Add a **Button** property (e.g. named "Upload to Meta") with one automation step:

- **Send webhook** → URL: `https://<your-n8n>/webhook/meta-ad-uploader`
  (your n8n instance's production webhook URL for the imported workflow).
- Payload: send the **page id**. Notion's button can send the current page; the workflow's `Parse Trigger`
  node accepts several shapes (`body.data.id`, `body.id`, `body.pageId`, `query.pageId`), so any of those
  works. If your Notion button can't shape the body, the simplest is a query param `?pageId=<page id>` or a
  small relay.

Clicking the button fires the webhook → n8n reads that page → uploads.

## Naming convention (the `var:N` token)

The uploader numbers variations by replacing a `var:N` token in the **Ad Name**. So if your Ad Name formula
produces:

```
8MH_324_var:1_sd:new-vsl_persona:declining-adult_media:video_...
```

the uploader creates Var 1 with `var:1`, Var 2 with `var:2`, etc. Your convention can be anything — just
keep a `var:N`-style token (or adjust `variationRegex` + `perVariationAdName`; see `ADAPTING.md` #4).
Filenames in the Frame.io folder should also carry the variation number (`... Var 1.mp4`, `V2.mov`, …) so
each file maps to the right variation.

## Duplicating a starter board

The fastest path is to duplicate an existing board that already has these columns + the button, then point
the button's webhook at your n8n. If you're building fresh, create the columns above, add the button, and
let the AI co-pilot confirm the field mapping against what you built.
