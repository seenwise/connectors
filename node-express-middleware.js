// Seenwise — generic Node/Express app middleware AI-traffic connector.
// For any Node server without an edge layer: Render, Heroku, Fly.io, Railway, a VPS, or a Remix/Next.js
// app served via a custom Node server. (On Cloudflare/Vercel prefer the edge connectors.)
//
// It hooks res.on('finish'), so it sees the response STATUS → captures crawler reads AND 404
// content-gaps. Filters to AI-related requests only (the Seenwise server re-validates).
//
// Usage:  app.use(seenwiseAttribution());   // mount as early as possible, before your routes
// Env:    SEENWISE_BRAND, SEENWISE_INGEST_KEY   (set these in your host's env vars)
const { isAiHit } = require("./lib/bots.cjs");

const INGEST =
  process.env.SEENWISE_INGEST_URL || "https://api.tryseenwise.com/ingest";
const BRAND = process.env.SEENWISE_BRAND;
const KEY = process.env.SEENWISE_INGEST_KEY;

function seenwiseAttribution() {
  return (req, res, next) => {
    const ua = req.headers["user-agent"] || "";
    const ref = req.headers["referer"] || "";
    res.on("finish", () => {
      let host = "";
      try {
        host = new URL(ref).hostname;
      } catch {
        /* no/invalid referer */
      }
      if (BRAND && KEY && isAiHit(ua, host)) {
        fetch(INGEST, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${KEY}`,
          },
          body: JSON.stringify({
            brandId: BRAND,
            source: "node_mw",
            logs: [
              {
                ts: new Date().toISOString(),
                path: req.originalUrl,
                userAgent: ua,
                referer: ref,
                status: res.statusCode,
                ip: req.ip,
              },
            ],
          }),
        }).catch(() => {});
      }
    });
    next();
  };
}

module.exports = { seenwiseAttribution };
