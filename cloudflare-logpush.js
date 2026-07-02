// Seenwise — Cloudflare Logpush async connector (Enterprise).
// For high-traffic Cloudflare zones that prefer Logpush over the inline Worker. Logpush streams HTTP
// request logs (filtered to AI traffic) to this small Worker, which reshapes and batches them to Seenwise.
//
//   Cloudflare → Logpush (AI filter) → this Worker → POST /ingest (source: cf_logpush)
//
// Deploy this Worker, set vars SEENWISE_BRAND + SEENWISE_INGEST_KEY, then create the Logpush job
// (one-time, via the API) — see the cURL at the bottom. Set the job's timestamp_format=rfc3339.

import { isAiHit } from "./lib/bots.js"; // single source (generated) — no drift from classify()

export default {
  async fetch(req, env) {
    if (req.method !== "POST") return new Response("ok"); // Logpush sends an ownership-check GET/POST
    const INGEST =
      env.SEENWISE_INGEST_URL || "https://api.tryseenwise.com/ingest";

    // Logpush delivers gzipped NDJSON (one log object per line).
    let text;
    if ((req.headers.get("content-encoding") || "").includes("gzip")) {
      text = await new Response(
        req.body.pipeThrough(new DecompressionStream("gzip")),
      ).text();
    } else {
      text = await req.text();
    }

    const logs = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const ua = o.ClientRequestUserAgent || "";
      const ref = o.ClientRequestReferer || "";
      let host = "";
      try {
        host = new URL(ref).hostname;
      } catch {
        /* not a url */
      }
      if (!isAiHit(ua, host)) continue;
      // Truncate + coerce so one oversized header or a string status can never invalidate the batch.
      logs.push({
        ts: String(o.EdgeStartTimestamp || new Date().toISOString()).slice(
          0,
          40,
        ),
        path: String(o.ClientRequestURI || o.ClientRequestPath || "/").slice(
          0,
          2048,
        ),
        userAgent: ua.slice(0, 1024),
        referer: ref.slice(0, 2048),
        status: Number(o.EdgeResponseStatus) || undefined,
        ip: o.ClientIP,
      });
    }

    for (let i = 0; i < logs.length; i += 500) {
      await fetch(INGEST, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.SEENWISE_INGEST_KEY}`,
        },
        body: JSON.stringify({
          brandId: env.SEENWISE_BRAND,
          source: "cf_logpush",
          logs: logs.slice(i, i + 500),
        }),
      }).catch(() => {});
    }
    return new Response("ok");
  },
};

/* ---------------------------------------------------------------------------
 Create the Logpush job (once). Replace ZONE_ID, CF_API_TOKEN, and the Worker URL.
 The `filter` below is a COARSE Cloudflare-side volume pre-filter (a representative subset — it is
 NOT the single source; the Worker above re-filters precisely via lib/bots.js). Broaden it (or drop
 it) to catch newer engines; anything it lets through, the Worker filters exactly.

 curl -X POST "https://api.cloudflare.com/client/v4/zones/ZONE_ID/logpush/jobs" \
   -H "Authorization: Bearer CF_API_TOKEN" -H "Content-Type: application/json" \
   --data '{
     "name": "seenwise-ai",
     "destination_conf": "https://seenwise-logpush.YOURNAME.workers.dev",
     "dataset": "http_requests",
     "output_options": {
       "field_names": ["EdgeStartTimestamp","ClientRequestURI","ClientRequestUserAgent","ClientRequestReferer","EdgeResponseStatus","ClientIP"],
       "timestamp_format": "rfc3339"
     },
     "filter": "{\"where\":{\"or\":[{\"key\":\"ClientRequestUserAgent\",\"operator\":\"contains\",\"value\":\"GPTBot\"},{\"key\":\"ClientRequestUserAgent\",\"operator\":\"contains\",\"value\":\"ChatGPT-User\"},{\"key\":\"ClientRequestUserAgent\",\"operator\":\"contains\",\"value\":\"PerplexityBot\"},{\"key\":\"ClientRequestUserAgent\",\"operator\":\"contains\",\"value\":\"ClaudeBot\"},{\"key\":\"ClientRequestReferer\",\"operator\":\"contains\",\"value\":\"perplexity.ai\"},{\"key\":\"ClientRequestReferer\",\"operator\":\"contains\",\"value\":\"chatgpt.com\"},{\"key\":\"ClientRequestReferer\",\"operator\":\"contains\",\"value\":\"claude.ai\"}]}}"
   }'
--------------------------------------------------------------------------- */
