// _meta-graph.js — minimal Meta Marketing API client.
// - Version-pinned base URL (from _meta-uploader-config.js)
// - System-user token from env (META_ACCESS_TOKEN)
// - Retry with backoff on transient + rate-limit errors; respects the
//   x-business-use-case-usage header signal by backing off harder on rate codes.
// - Structured errors: err.fbCode, err.fbSubcode, err.httpStatus, err.step
//
// ESM to match the other api/*.js handlers (Vercel bundles these as ESM).

import cfg from './_meta-uploader-config.js';

const apiBase = () => `https://graph.facebook.com/${cfg.GRAPH_VERSION}`;
const accessToken = () => process.env.META_ACCESS_TOKEN;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry policy:
//   Rate limits — 4 (app), 17 (user), 80004 (ads-management): ridden out within a TIME budget,
//     honoring Meta's own "try again in X" signal (Retry-After / x-business-use-case-usage) so a
//     brief throttle doesn't half-build a concept.
//   Transient — 1 (unknown), 2 (service down), any 5xx, network blips: a few bounded attempts.
// NOT retryable: 100 (bad param), 190 (token), 2635 (policy), 368 (block) — thrown immediately.
const RATE_CODES = new Set([4, 17, 80004]);

// Bounded so one call can't blow build-concept's ~300s function cap (n8n also caps the HTTP call
// at 280s). Throttles at 5-concurrent are rare/brief; this rides those out.
const RATE_RETRY_BUDGET_MS = 60000; // keep retrying a throttled call for up to ~60s
const MAX_TRANSIENT_ATTEMPTS = 4;   // network / 5xx / transient error attempts

// Meta's own "wait this long" signal (ms) from response headers; 0 if none. Capped so a single
// suggested wait can't stall the function (a multi-minute throttle is better failed than waited on).
function suggestedWaitMs(res) {
  const CAP = 45000;
  const ra = Number(res.headers.get('retry-after')); // seconds (standard header)
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, CAP);
  try {
    const buc = res.headers.get('x-business-use-case-usage');
    if (buc) {
      let estMin = 0; // estimated_time_to_regain_access is in MINUTES
      for (const arr of Object.values(JSON.parse(buc))) {
        for (const u of (arr || [])) estMin = Math.max(estMin, Number(u.estimated_time_to_regain_access) || 0);
      }
      if (estMin > 0) return Math.min(estMin * 60000, CAP);
    }
  } catch { /* header missing or not JSON — no signal */ }
  return 0;
}

function parseError(json, status) {
  const e = (json && json.error) || {};
  const err = new Error(e.message || `HTTP ${status}`);
  err.fbCode = e.code;
  err.fbSubcode = e.error_subcode;
  err.fbType = e.type;
  err.fbTraceId = e.fbtrace_id;
  err.httpStatus = status;
  return err;
}

async function request(method, path, { body, query } = {}) {
  let url = `${apiBase()}/${path}`;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    url += (url.includes('?') ? '&' : '?') + qs;
  }

  const start = Date.now();
  let rateWaits = 0;      // rate-limit backoffs so far (scales the fallback backoff)
  let transientTries = 0; // network / 5xx / transient attempts so far

  while (true) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken()}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      if (transientTries >= MAX_TRANSIENT_ATTEMPTS - 1) throw networkErr; // give up after bounded tries
      transientTries += 1;
      await sleep(1500 * transientTries);
      continue;
    }

    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

    if (res.ok) return json;

    const err = parseError(json, res.status);
    err.step = path;

    // Rate limit: ride out the throttle within the time budget, honoring Meta's suggested wait.
    if (RATE_CODES.has(err.fbCode)) {
      if (Date.now() - start < RATE_RETRY_BUDGET_MS) {
        rateWaits += 1;
        let wait = suggestedWaitMs(res) || Math.min(6000 * rateWaits, 30000);
        wait += Math.floor(Math.random() * 2000); // jitter — desync concurrent callers
        await sleep(wait);
        continue;
      }
      throw err;
    }

    // Transient (unknown/service-down/5xx): a few bounded attempts.
    const transient = err.fbCode === 1 || err.fbCode === 2 || res.status >= 500;
    if (transient && transientTries < MAX_TRANSIENT_ATTEMPTS - 1) {
      transientTries += 1;
      await sleep(2000 * transientTries);
      continue;
    }

    throw err; // not retryable (100/190/2635/…) or attempts exhausted
  }
}

export function graph(method, path, body) {
  return request(method, path, { body });
}

export function graphGet(path, query) {
  return request('GET', path, { query });
}

export { apiBase, accessToken };
