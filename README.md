# Meta Ad Uploader

One click on a Notion row publishes that creative concept's variations into Meta Ads Manager —
replicating the manual builder-campaign / post-ID-reuse workflow, fully automatically. Everything is
created **paused** for human review.

**Notion (creative board) → n8n (orchestration) → Vercel functions → Meta Marketing API.**
Creative is pulled from **Frame.io**.

---

## 🤖 Easiest setup: let an AI walk you through it

This repo is built to be set up **with an AI assistant**. Open it in **Claude Code** (or any agentic AI
coding tool), and say:

> "Help me set up this Meta Ad Uploader for my accounts."

The AI reads [`CLAUDE.md`](CLAUDE.md) — a setup co-pilot — and guides you step by step: creating the Meta
app + token, deploying to Vercel, importing the n8n workflow, building the Notion board, filling in your
config, and running a first test. It verifies each step as it goes.

Prefer to do it by hand? Follow **[`SETUP.md`](SETUP.md)** — the same steps, written out.

---

## What's in here

| Path | What it is |
|---|---|
| `api/` | The 5 Vercel serverless functions (the upload logic). |
| `api/_meta-uploader-config.example.js` | Copy to `_meta-uploader-config.js` and fill in your IDs. |
| `.env.example` | The secrets (tokens) — set these in Vercel + locally. Never commit the filled-in version. |
| `vercel.json` / `package.json` | Vercel deploy config. |
| `n8n-workflow.json` | The n8n workflow — import it, re-link your Notion credential, point it at your Vercel URL. |
| `SETUP.md` | Full manual setup guide. |
| `NOTION-BOARD.md` | The exact Notion board schema, naming convention, and the "Upload to Meta" button. |
| `CLAUDE.md` | The AI setup co-pilot (read automatically by Claude Code). |

## What you'll need (5 systems)

1. **Meta** — Business Manager, a Facebook Page + linked Instagram, an ad account, a Developer App with the
   Marketing API, a **system-user token** (`ads_management` + `pages_manage_ads`), a Pixel, and two
   pre-made campaigns (a paused "builder" + a "testing"). Optionally the Standard API tier (avoids rate limits).
2. **Frame.io** (V4) — where your creative lives, + an Adobe OAuth app for API access.
3. **Vercel** (Pro recommended) — hosts the functions.
4. **n8n** (Cloud Starter is enough) — runs the workflow.
5. **Notion** — the creative board + an "Upload to Meta" button.

See **[`SETUP.md`](SETUP.md)** for the details, or just let the AI drive.

## How it works (once set up)

1. You click **Upload to Meta** on a Notion concept row → fires a webhook to n8n.
2. n8n marks the row **Uploading**, then calls `prepare-media`: it pulls the variation files from the
   concept's Frame.io folder and uploads them to Meta (in parallel).
3. n8n polls `check-media` until the videos finish processing (any length — it waits patiently).
4. n8n calls `build-concept`: it creates the **builder** campaign ad sets (a new-post ad that creates the
   page post + an existing-post ad that shares its engagement) and the **testing** ad set — all reusing one
   post ID per variation so engagement is shared.
5. Everything lands **paused**. The row flips to **Done** with the created IDs, or **Error** with a reason.

Batches auto-space (n8n runs a few at a time and queues the rest), so you can click many at once.
