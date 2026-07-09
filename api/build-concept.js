// build-concept.js — the post-ID-chaining ad build sequence (the bespoke core).
//
// Naming mirrors the manual convention (verified against existing ads 2026-06-20):
//   per-variation Ad Name = the Notion "Ad Name" with its var:N set to this variation's number
//   - Builder ad set      = per-variation Ad Name
//   - Builder new-post ad = "[BUILDER] " + per-variation Ad Name   (creates the page post)
//   - Builder existing ad = per-variation Ad Name                  (references that post — shared engagement)
//   - Testing ad set      = the Notion "Adset Name" (short form, var:1-N range)
//   - Testing ads         = per-variation Ad Name, created ACTIVE (ad set stays PAUSED so a single
//                           ad-set toggle launches the whole concept)
//
// Two passes: create all builder new-post ads first, THEN read post ids + build existing-post ads
// (effective_object_story_id lags after creation, longer for video).
// One-shot post rule: the post is created ONCE and only ever referenced via object_story_id.
// Every creative carries url_tags (standard tracking params).

import cfg from './_meta-uploader-config.js';
import { graph, graphGet } from './_meta-graph.js';

function configErr(msg) { const e = new Error(msg); e.fbCode = 'CONFIG'; return e; }

function parseBody(raw) {
  let body = raw;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }
  if (body && typeof body === 'object' && !Array.isArray(body) && body.adNameBase === undefined) {
    const keys = Object.keys(body);
    if (keys.length === 1 && typeof keys[0] === 'string' && keys[0].startsWith('{')) {
      try { body = JSON.parse(keys[0]); } catch {}
    }
  }
  return body || {};
}

function resolveIdentity(identityKey) {
  const map = cfg.identities || {};
  let id = map[identityKey];
  if (!id && identityKey) {
    const want = String(identityKey).trim().toLowerCase();
    const hit = Object.keys(map).find((k) => k.trim().toLowerCase() === want);
    if (hit) id = map[hit];
  }
  if (!id) throw configErr(`Identity "${identityKey}" is not in the config identity map — add it to _meta-uploader-config.js (page_id + instagram_user_id).`);
  if (!id.page_id || !id.instagram_user_id) throw configErr(`Identity "${identityKey}" is not fully configured (missing page_id/instagram_user_id) in _meta-uploader-config.js.`);
  return id;
}

// Notion stores Primary Text with literal <br> tags — Meta wants real newlines.
function sanitizeText(s) {
  if (!s) return s;
  return String(s).replace(/<br\s*\/?>/gi, '\n').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function varNumFromLabel(label) {
  const m = String(label || '').match(/(\d+)/);
  return m ? m[1] : null;
}

// Per-variation ad name: set the var:N token to this variation's number. No " | Var N" suffix.
function perVariationAdName(adNameBase, varNum) {
  const base = String(adNameBase || '');
  if (varNum && /var:\s*\d+/i.test(base)) return base.replace(/var:\s*\d+/i, 'var:' + varNum);
  return base;
}

function buildObjectStorySpec(identity, v, { headline, primaryText, targetUrl }) {
  const title = sanitizeText(headline);
  const message = sanitizeText(primaryText);
  const call_to_action = { type: cfg.defaultCallToAction, value: { link: targetUrl } };
  const base = { page_id: identity.page_id, instagram_user_id: identity.instagram_user_id };
  if (v.type === 'image') {
    if (!v.imageHash) throw configErr(`variation "${v.variationLabel}" is type image but has no imageHash`);
    return { ...base, link_data: { image_hash: v.imageHash, link: targetUrl, message, name: title, call_to_action } };
  }
  if (!v.videoId) throw configErr(`variation "${v.variationLabel}" is type video but has no videoId`);
  const video_data = { video_id: v.videoId, title, message, call_to_action };
  if (v.thumbnailUrl) video_data.image_url = v.thumbnailUrl;
  return { ...base, video_data };
}

// Poll effective_object_story_id (lags after creative creation; longer for video). ~60s cap, early exit.
async function readPostId(creativeId) {
  let postId = null;
  for (let attempt = 0; attempt < 30 && !postId; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
    const got = await graphGet(`${creativeId}`, { fields: 'effective_object_story_id' });
    postId = got && got.effective_object_story_id;
  }
  if (!postId) throw configErr(`could not read effective_object_story_id for creative ${creativeId} after retries`);
  return postId;
}

export default async function handler(req, res) {
  const body = parseBody(req.body);
  const { adNameBase, adSetNameBase, identityKey, targetUrl, primaryText, headline, variations } = body;

  const acct = cfg.AD_ACCOUNT_ID;
  const enh = cfg.creativeEnhancements;
  const urlTags = cfg.urlTags;
  const result = { builder: [], testing: { adSetId: null, ads: [] }, postIds: {} };
  let step = 'init';

  try {
    if (req.method !== 'POST') throw configErr('method must be POST');
    if (!adNameBase || !adSetNameBase) throw configErr('adNameBase and adSetNameBase are required');
    if (!targetUrl) throw configErr('targetUrl is required');
    if (!Array.isArray(variations) || variations.length === 0) throw configErr('variations[] is required and must be non-empty');

    const identity = resolveIdentity(identityKey);

    // ---------- BUILDER pass 1: ad set + new-post creative + new-post ad ----------
    for (const v of variations) {
      const label = v.variationLabel || `Var ${result.builder.length + 1}`;
      const varNum = varNumFromLabel(label);
      const adName = perVariationAdName(adNameBase, varNum);
      const rec = { label, adName };

      step = `builder adset (${label})`;
      const adset = await graph('POST', `${acct}/adsets`, {
        ...cfg.adSetDefaults,
        name: adName,
        campaign_id: cfg.BUILDER_CAMPAIGN_ID,
      });
      rec.builderAdSetId = adset.id;

      // Videos need a thumbnail (image_url). If none supplied, use Meta's auto-generated one.
      if (v.type !== 'image' && !v.thumbnailUrl && v.videoId) {
        step = `fetch video thumbnail (${label})`;
        const thumbs = await graphGet(`${v.videoId}/thumbnails`, { fields: 'uri,is_preferred' });
        const list = (thumbs && thumbs.data) || [];
        const pref = list.find((t) => t.is_preferred) || list[0];
        if (pref && pref.uri) v.thumbnailUrl = pref.uri;
      }

      step = `builder new-post creative (${label})`;
      const oss = buildObjectStorySpec(identity, v, { headline, primaryText, targetUrl });
      const newCreative = await graph('POST', `${acct}/adcreatives`, {
        name: `[BUILDER] ${adName}`,
        object_story_spec: oss,
        url_tags: urlTags,
        ...enh,
      });
      rec.newPostCreativeId = newCreative.id;

      step = `builder new-post ad (${label})`;
      const newAd = await graph('POST', `${acct}/ads`, {
        name: `[BUILDER] ${adName}`,
        adset_id: rec.builderAdSetId,
        creative: { creative_id: rec.newPostCreativeId },
        status: 'PAUSED',
      });
      rec.newPostAdId = newAd.id;

      result.builder.push(rec);
    }

    // ---------- BUILDER pass 2: read post id + existing-post creative + ad ----------
    for (const rec of result.builder) {
      const label = rec.label;

      step = `read post id (${label})`;
      rec.postId = await readPostId(rec.newPostCreativeId);
      result.postIds[label] = rec.postId;

      step = `builder existing-post creative (${label})`;
      const exCreative = await graph('POST', `${acct}/adcreatives`, {
        name: rec.adName,
        object_story_id: rec.postId,
        url_tags: urlTags,
        ...enh,
      });
      rec.existingPostCreativeId = exCreative.id;

      step = `builder existing-post ad (${label})`;
      const exAd = await graph('POST', `${acct}/ads`, {
        name: rec.adName,
        adset_id: rec.builderAdSetId,
        creative: { creative_id: rec.existingPostCreativeId },
        status: 'PAUSED',
      });
      rec.existingPostAdId = exAd.id;
    }

    // ---------- TESTING campaign: one ad set (PAUSED), existing-post ads ACTIVE ----------
    step = 'testing adset';
    const testAdset = await graph('POST', `${acct}/adsets`, {
      ...cfg.adSetDefaults,
      name: adSetNameBase,
      campaign_id: cfg.TESTING_CAMPAIGN_ID,
    });
    result.testing.adSetId = testAdset.id;

    for (const rec of result.builder) {
      const label = rec.label;
      step = `testing existing-post creative (${label})`;
      const tCreative = await graph('POST', `${acct}/adcreatives`, {
        name: rec.adName,
        object_story_id: rec.postId, // SAME post → engagement shared with the builder ads
        url_tags: urlTags,
        ...enh,
      });
      step = `testing existing-post ad (${label})`;
      const tAd = await graph('POST', `${acct}/ads`, {
        name: rec.adName,
        adset_id: result.testing.adSetId,
        creative: { creative_id: tCreative.id },
        status: 'ACTIVE', // ads ON; the ad set stays PAUSED so one toggle launches the concept
      });
      result.testing.ads.push({ label, creativeId: tCreative.id, adId: tAd.id, postId: rec.postId });
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      failedStep: step,
      fbCode: err.fbCode,
      fbSubcode: err.fbSubcode,
      message: err.message,
      partial: result,
    });
  }
}
