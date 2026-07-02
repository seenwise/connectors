// Seenwise — Cloudflare Worker AI-traffic connector.
// Runs at the edge in front of your origin, so it sees EVERY request AND its response status →
// captures crawler reads AND 404 content-gaps. Forwards only AI-related requests; the Seenwise
// server re-validates. See design/attribution-ingestion-plan.md.
//
// Deploy: `wrangler deploy`, add a route (yourdomain.com/*), then set two secrets — never commit them:
//   wrangler secret put SEENWISE_BRAND   # your Seenwise brand id
//   wrangler secret put SEENWISE_KEY     # your Seenwise ingest key (write-only)
import { isAiHit } from "./lib/bots.js";

const INGEST = "https://api.tryseenwise.com/ingest";

export default {
  async fetch(req, env, ctx) {
    const ua = req.headers.get("user-agent") || "";
    const ref = req.headers.get("referer") || "";
    let host = "";
    try {
      host = new URL(ref).hostname;
    } catch {
      /* no/invalid referer */
    }

    const res = await fetch(req); // read the origin response so we can log its status (200 vs 404)

    if (env.SEENWISE_BRAND && env.SEENWISE_KEY && isAiHit(ua, host)) {
      // waitUntil keeps the response fast; the POST runs after the visitor is served.
      ctx.waitUntil(
        fetch(INGEST, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${env.SEENWISE_KEY}`,
          },
          body: JSON.stringify({
            brandId: env.SEENWISE_BRAND,
            source: "cf_worker",
            logs: [
              {
                ts: new Date().toISOString(),
                path: (u => u.pathname + u.search)(new URL(req.url)), // query kept: utm_source=chatgpt.com recovers stripped referers
                userAgent: ua,
                referer: ref,
                status: res.status,
                ip: req.headers.get("cf-connecting-ip") || undefined,
              },
            ],
          }),
        }).catch(() => {}),
      );
    }

    return res; // pass the origin response through unchanged
  },
};
