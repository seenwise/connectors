// Seenwise — Vercel Edge Middleware AI-traffic connector.
// Drop this in as `middleware.ts` at your Next.js / Vercel project root. Set SEENWISE_BRAND and
// SEENWISE_INGEST_KEY in your Vercel project env vars.
//
// NOTE: middleware runs BEFORE the response, so it captures crawler READS but NOT 404 content-gaps
// (it can't see the status). For 404s + guaranteed delivery at scale, prefer a Vercel Log Drain
// (Pro+) or put Cloudflare in front. See design/attribution-ingestion-plan.md.
import { NextResponse } from "next/server";

import { isAiHit } from "./lib/bots.js";

export const config = { matcher: "/((?!_next/|favicon\\.ico).*)" };

const INGEST = "https://api.tryseenwise.com/ingest";
const BRAND = process.env.SEENWISE_BRAND ?? "";
const INGEST_KEY = process.env.SEENWISE_INGEST_KEY ?? "";

export function middleware(req: Request) {
  const ua = req.headers.get("user-agent") ?? "";
  const ref = req.headers.get("referer") ?? "";
  let host = "";
  try {
    host = new URL(ref).hostname;
  } catch {
    /* no/invalid referer */
  }
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();

  if (BRAND && INGEST_KEY && isAiHit(ua, host)) {
    void fetch(INGEST, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${INGEST_KEY}`,
      },
      body: JSON.stringify({
        brandId: BRAND,
        source: "vercel_mw",
        logs: [
          {
            ts: new Date().toISOString(),
            path: new URL(req.url).pathname,
            userAgent: ua,
            referer: ref,
            ip,
          },
        ],
      }),
    }).catch(() => {});
  }

  return NextResponse.next();
}
