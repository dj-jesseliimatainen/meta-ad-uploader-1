// prepare-media.js — Frame.io folder -> Meta media handles.
//
// Lists a Frame.io folder, maps each file to a variation by its filename, and uploads
// to Meta: videos via `file_url` (Meta fetches Frame.io's public 24h presigned URL
// directly — no byte proxying), images by streaming the bytes to /adimages. Returns
// media handles that build-concept consumes.
//
// POST /api/prepare-media
// Body: { outputLink?, frameioFolderId?, variationsExpected?, identityKey? }
// Returns:
//   { ok:true, folderId, media:[{variationLabel,type,name,videoId?,imageHash?}], needsPolling:[videoId...] }
//   { ok:false, failedStep, message }
//
// ⚠ UNTESTED end-to-end: needs FRAMEIO_TOKEN (+ FRAMEIO_ACCOUNT_ID for v4). The
// Frame.io URL -> folderId extraction and the v2/v4 response shapes should be
// re-checked against one real Output Link once the token exists.

import cfg from './_meta-uploader-config.js';
import { graph, graphGet, apiBase, accessToken } from './_meta-graph.js';

// Mint a fresh Frame.io (Adobe IMS) access token from the stored refresh token on each run,
// so the integration is "set once" (refresh tokens are long-lived). Falls back to a static
// FRAMEIO_TOKEN if no refresh creds are present.
async function frameioAccessToken() {
  const refresh = process.env.FRAMEIO_REFRESH_TOKEN;
  const clientId = process.env.FRAMEIO_CLIENT_ID;
  const clientSecret = process.env.FRAMEIO_CLIENT_SECRET;
  if (refresh && clientId && clientSecret) {
    const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refresh });
    const res = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.access_token) return json.access_token;
    throw fail('frameio auth', `Adobe IMS token refresh failed: ${json.error || ('HTTP ' + res.status)}`);
  }
  if (process.env.FRAMEIO_TOKEN) return process.env.FRAMEIO_TOKEN;
  throw fail('frameio auth', 'No Frame.io credentials (need FRAMEIO_REFRESH_TOKEN + FRAMEIO_CLIENT_ID + FRAMEIO_CLIENT_SECRET, or a static FRAMEIO_TOKEN)');
}
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function fail(step, msg) { const e = new Error(msg); e.step = step; return e; }

function parseBody(raw) {
  let body = raw;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }
  if (body && typeof body === 'object' && !Array.isArray(body) && body.outputLink === undefined && body.frameioFolderId === undefined) {
    const keys = Object.keys(body);
    if (keys.length === 1 && typeof keys[0] === 'string' && keys[0].startsWith('{')) {
      try { body = JSON.parse(keys[0]); } catch {}
    }
  }
  return body || {};
}

// Extract a Frame.io folder id from an Output Link URL, or use an explicit id.
// Real board data: `Output Link` is often a SHORT SHARE link (e.g. https://f.io/RtKeEHvN),
// while `Feedback Link` is a full next.frame.io/project/{projectId}/{folderId} URL.
export function resolveFolderId(outputLink, frameioFolderId) {
  if (frameioFolderId) return frameioFolderId;
  if (!outputLink) throw fail('resolve folder', 'no outputLink or frameioFolderId provided');
  const link = String(outputLink);
  // next.frame.io/project/{projectId}/{folderOrViewId} -> the LAST uuid is the folder/view
  const uuids = link.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
  if (uuids.length) return uuids[uuids.length - 1];
  // Short share links point to a SHARE, not a folder. Enumerating a share's assets needs the
  // Frame.io shares API. ⚠ NOT implemented — needs the token + a decision on canonical source.
  if (/f\.io\//i.test(link) || /frame\.io\/(s|share|presentations)\//i.test(link)) {
    throw fail('resolve folder', `Output Link is a Frame.io SHARE link (${link}); share->asset resolution isn't implemented yet. Provide a folder id, a next.frame.io project/folder link, or add share-API support.`);
  }
  const tail = link.split('?')[0].split('/').filter(Boolean).pop();
  if (tail) return tail;
  throw fail('resolve folder', `could not extract a Frame.io folder id from: ${link}`);
}

function normalizeAsset(a) {
  if (cfg.FRAMEIO_API_VERSION === 'v2') {
    const mime = a.filetype || '';
    return {
      kind: a.type === 'folder' ? 'folder' : 'file',
      name: a.name,
      mediaType: mime.startsWith('video') ? 'video' : (mime.startsWith('image') ? 'image' : 'other'),
      downloadUrl: a.original,
    };
  }
  // v4
  const cat = a.file_type_category || '';
  const mime = a.media_type || '';
  const isVideo = cat === 'video' || mime.startsWith('video');
  const isImage = cat === 'image' || mime.startsWith('image');
  return {
    kind: a.type === 'file' ? 'file' : (a.type === 'folder' ? 'folder' : 'other'),
    name: a.name,
    mediaType: isVideo ? 'video' : (isImage ? 'image' : 'other'),
    downloadUrl: a.media_links && a.media_links.original && a.media_links.original.download_url,
  };
}

async function frameioGet(token, url, step = 'frameio list') {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw fail(step, `Frame.io ${res.status}: ${(json && (json.message || json.error)) || String(text).slice(0, 200)}`);
  return json;
}

// List the playable media in a Frame.io folder.
// v4 folders contain *version stacks* whenever an editor re-uploads or revises a clip — these are
// type:"version_stack", NOT type:"file". The old `?type=file` query silently dropped them, so a
// 4-variation concept looked like 2 files (this was the 8MH_56.5 bug). We now list everything and
// resolve each stack to its CURRENT cut (head_version) by fetching that file for its download URL.
export async function frameioListFiles(folderId) {
  const token = await frameioAccessToken();

  if (cfg.FRAMEIO_API_VERSION === 'v2') {
    const json = await frameioGet(token, `https://api.frame.io/v2/assets/${folderId}/children`);
    const items = Array.isArray(json) ? json : (json.assets || []);
    return items.map(normalizeAsset).filter((a) => a.kind === 'file');
  }

  // v4
  if (!cfg.FRAMEIO_ACCOUNT_ID) throw fail('frameio config', 'FRAMEIO_ACCOUNT_ID required for v4 (set in env/config)');
  const base = `https://api.frame.io/v4/accounts/${cfg.FRAMEIO_ACCOUNT_ID}`;
  // No `type=file` filter (that hides version stacks). page_size 100 covers any real concept folder.
  const json = await frameioGet(token, `${base}/folders/${folderId}/children?include=media_links.original&page_size=100`);
  const children = json.data || [];

  const files = [];
  for (const c of children) {
    if (c.type === 'file') {
      files.push(normalizeAsset(c));
    } else if (c.type === 'version_stack') {
      // head_version carries the current version's id but not its media_links — fetch the file.
      const headId = c.head_version && c.head_version.id;
      if (!headId) throw fail('frameio list', `version stack "${c.name}" has no resolvable current version`);
      const got = await frameioGet(token, `${base}/files/${headId}?include=media_links.original`);
      const file = got.data || got;
      files.push(normalizeAsset({ ...file, name: file.name || c.name }));
    }
    // folders / other asset types are intentionally skipped (flat output-folder assumption).
  }

  // Order by variation number so builder ad sets get created Var 1..N, not in upload order.
  const num = (a) => { const m = String(a.name || '').match(cfg.variationRegex); return m ? Number(m[1]) : Infinity; };
  files.sort((a, b) => num(a) - num(b));
  return files;
}

function variationLabelFromName(name, fallbackIdx) {
  const m = String(name || '').match(cfg.variationRegex);
  return m ? `Var ${m[1]}` : `Var ${fallbackIdx}`;
}

async function uploadVideoByUrl(fileUrl, name) {
  const r = await graph('POST', `${cfg.AD_ACCOUNT_ID}/advideos`, { file_url: fileUrl, name });
  return r.id; // video_id (async processing — caller polls readiness)
}

async function uploadImageBytes(fileUrl, name) {
  const dl = await fetch(fileUrl);
  if (!dl.ok) throw fail('image download', `download failed ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  const form = new FormData();
  form.append('filename', new Blob([buf]), name || 'image.jpg');
  const res = await fetch(`${apiBase()}/${cfg.AD_ACCOUNT_ID}/adimages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken()}` },
    body: form,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw fail('image upload', `adimages ${res.status}: ${(json && json.error && json.error.message) || String(text).slice(0, 200)}`);
  const first = Object.values(json.images || {})[0];
  if (!first || !first.hash) throw fail('image upload', 'no hash returned from /adimages');
  return first.hash;
}

// Video-readiness polling now lives in `check-media.js` — a fast single-shot check that n8n loops
// on with a Wait node. Keeping the wait OUT of this request means a long video's processing time
// can't hold the connection past the 280s n8n / 300s function timeout (the 8MH_324 failure).

export default async function handler(req, res) {
  const body = parseBody(req.body);
  const { outputLink, frameioFolderId, variationsExpected } = body;
  let step = 'init';
  try {
    if (req.method !== 'POST') throw fail('init', 'method must be POST');

    step = 'resolve folder';
    const folderId = resolveFolderId(outputLink, frameioFolderId);

    step = 'frameio list';
    const files = await frameioListFiles(folderId);
    if (!files.length) throw fail('frameio list', `no files found in Frame.io folder ${folderId}`);
    if (variationsExpected && Number(variationsExpected) !== files.length) {
      throw fail('variation count', `Frame.io folder has ${files.length} file(s) but Notion expects ${variationsExpected} variation(s)`);
    }

    // Upload every variation to Meta IN PARALLEL (was sequential). Order is preserved. We do NOT
    // wait for videos to finish transcoding here — readiness is polled afterward by `check-media`
    // (n8n loops on it), so this returns as soon as the uploads are accepted, however long the
    // videos are.
    step = 'upload media';
    const media = await Promise.all(files.map(async (f, i) => {
      const label = variationLabelFromName(f.name, i + 1);
      if (!f.downloadUrl) throw fail(`download url (${label})`, `no download URL for "${f.name}" — check Frame.io download permission / media_links include`);
      if (f.mediaType === 'video') {
        const videoId = await uploadVideoByUrl(f.downloadUrl, f.name);
        return { variationLabel: label, type: 'video', name: f.name, videoId };
      }
      if (f.mediaType === 'image') {
        const imageHash = await uploadImageBytes(f.downloadUrl, f.name);
        return { variationLabel: label, type: 'image', name: f.name, imageHash };
      }
      throw fail(`media type (${label})`, `unsupported media type for "${f.name}"`);
    }));
    const needsPolling = media.filter((m) => m.type === 'video').map((m) => m.videoId);

    // Return immediately. `deadline` tells the n8n readiness loop how long to keep checking before
    // giving up (~20 min — comfortably covers long VSL-length videos).
    const deadline = Date.now() + 20 * 60 * 1000;
    return res.status(200).json({ ok: true, folderId, media, needsPolling, deadline });
  } catch (err) {
    return res.status(200).json({ ok: false, failedStep: err.step || step, message: err.message });
  }
}
