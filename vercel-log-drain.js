// Seenwise — Vercel Log Drain async connector (Pro / Enterprise).
// For higher-traffic Vercel projects that prefer a Log Drain over the inline middleware. Vercel POSTs
// request-log batches to this function, which keeps AI traffic and forwards it to Seenwise.
//
//   Vercel → Log Drain → this function → POST /ingest (source: vercel_drain)
//
// Deploy as a serverless function (its own Vercel project, or any Node host). Env: SEENWISE_BRAND,
// SEENWISE_INGEST_KEY, SEENWISE_INGEST_URL (optional). Then add a Log Drain in your Vercel project
// settings pointing at this function's URL (delivery format: JSON). On creation Vercel sends an
// `x-vercel-verify` header — this handler echoes it back so verification passes.

import { isAiHit } from "./lib/bots.js"; // single source (generated) — no drift from classify()

const INGEST =
  process.env.SEENWISE_INGEST_URL || "https://api.tryseenwise.com/ingest";
const BRAND = process.env.SEENWISE_BRAND;
const KEY = process.env.SEENWISE_INGEST_KEY;

function parseEvents(body) {
  if (Array.isArray(body)) return body;
  if (typeof body === "string") {
    const t = body.trim();
    if (!t) return [];
    if (t[0] === "[") {
      try {
        return JSON.parse(t);
      } catch {
        return [];
      }
    }
    return t
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
  return [];
}

export default async function handler(req, res) {
  // Echo Vercel's verification token so the drain can be created.
  const verify = req.headers["x-vercel-verify"];
  if (verify) res.setHeader("x-vercel-verify", verify);
  if (req.method !== "POST") return res.status(200).end("ok");

  const logs = [];
  for (const e of parseEvents(req.body)) {
    const p = e.proxy || {}; // request/edge logs carry the HTTP details under `proxy`
    const ua = p.userAgent || "";
    const ref = p.referer || "";
    let host = "";
    try {
      host = new URL(ref).hostname;
    } catch {
      /* not a url */
    }
    if (!isAiHit(ua, host)) continue;
    // Truncate + coerce so one oversized header or a string status can never invalidate the batch.
    logs.push({
      ts: e.timestamp
        ? new Date(e.timestamp).toISOString()
        : new Date().toISOString(),
      path: String(p.path || "/").slice(0, 2048),
      userAgent: ua.slice(0, 1024),
      referer: ref.slice(0, 2048),
      status: Number(p.statusCode) || undefined,
      ip: p.clientIp,
    });
  }

  for (let i = 0; i < logs.length; i += 500) {
    await fetch(INGEST, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        brandId: BRAND,
        source: "vercel_drain",
        logs: logs.slice(i, i + 500),
      }),
    }).catch(() => {});
  }
  return res.status(200).end("ok");
}
