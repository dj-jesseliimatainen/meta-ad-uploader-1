// check-media.js — fast readiness check for freshly-uploaded Meta videos.
//
// POST /api/check-media
// Body: { videoIds?: string[], media?: [{ type, videoId }] }
// Returns: { ok:true, ready:bool, hardError:bool, statuses:[{videoId,status,ready,errored}], pending:[], errored:[] }
//
// SINGLE-SHOT (no waiting). n8n polls this in a Wait-loop, so no request ever holds open while a
// video transcodes — that's what lets long videos finish without hitting the 280s/300s timeout wall
// that prepare-media used to hit (the 8MH_324 failure).

import { apiBase, accessToken } from './_meta-graph.js';

function parseBody(raw) {
  let body = raw;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }
  if (body && typeof body === 'object' && !Array.isArray(body) && body.videoIds === undefined && body.media === undefined) {
    const keys = Object.keys(body);
    if (keys.length === 1 && typeof keys[0] === 'string' && keys[0].startsWith('{')) {
      try { body = JSON.parse(keys[0]); } catch {}
    }
  }
  return body || {};
}

async function videoStatus(videoId) {
  try {
    const res = await fetch(`${apiBase()}/${videoId}?fields=status`, {
      headers: { Authorization: `Bearer ${accessToken()}` },
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      const s = (j && j.status && j.status.video_status) || 'unknown';
      return { videoId, status: s, ready: s === 'ready', errored: s === 'error' };
    }
    // Throttled/other non-OK → we don't know yet; treat as "keep waiting", NOT a hard failure.
    return { videoId, status: `http_${res.status}`, ready: false, errored: false };
  } catch {
    return { videoId, status: 'fetch_error', ready: false, errored: false };
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(200).json({ ok: false, message: 'method must be POST' });
    const body = parseBody(req.body);

    let ids = Array.isArray(body.videoIds) ? body.videoIds.filter(Boolean) : [];
    if (!ids.length && Array.isArray(body.media)) {
      ids = body.media.filter((m) => m && m.type === 'video' && m.videoId).map((m) => m.videoId);
    }
    // Image-only concept (or nothing to poll) → ready immediately.
    if (!ids.length) return res.status(200).json({ ok: true, ready: true, hardError: false, statuses: [], pending: [], errored: [] });

    const statuses = await Promise.all(ids.map(videoStatus));
    const errored = statuses.filter((s) => s.errored).map((s) => s.videoId);
    const pending = statuses.filter((s) => !s.ready && !s.errored).map((s) => s.videoId);
    const ready = errored.length === 0 && pending.length === 0;
    return res.status(200).json({ ok: true, ready, hardError: errored.length > 0, statuses, pending, errored });
  } catch (err) {
    return res.status(200).json({ ok: false, message: err.message });
  }
}
