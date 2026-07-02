// Seenwise — AWS CloudFront async connector (Lambda).
// CloudFront standard access logs land in S3; this Lambda parses each new log file, keeps only AI bot
// crawls + AI referral visits, and batches them to Seenwise. No inline latency, complete coverage.
//
//   CloudFront → S3 (standard logs) → S3 ObjectCreated → this Lambda → POST /ingest (source: aws_cf_s3)
//
// Setup:
//   1. Enable CloudFront *standard* logging to an S3 bucket/prefix.
//   2. Create this Lambda (Node.js 20.x). Env: SEENWISE_BRAND, SEENWISE_INGEST_KEY,
//      SEENWISE_INGEST_URL (optional, defaults to api.tryseenwise.com/ingest).
//   3. Grant the Lambda role s3:GetObject on the log bucket.
//   4. Add an S3 trigger (ObjectCreated, the log prefix) → this Lambda.
//
// (Use this OR Lambda@Edge — not a CloudFront Function, which can't make network calls.)

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { gunzipSync } from "node:zlib";

import { isAiHit } from "./lib/bots.js"; // single source (generated) — no drift from classify()

const INGEST =
  process.env.SEENWISE_INGEST_URL || "https://api.tryseenwise.com/ingest";
const BRAND = process.env.SEENWISE_BRAND;
const KEY = process.env.SEENWISE_INGEST_KEY;
const s3 = new S3Client({});

const dec = (v) => {
  if (!v || v === "-") return "";
  try {
    return decodeURIComponent(v.replace(/\+/g, " "));
  } catch {
    return v;
  }
};
const isAi = (ua, ref) => {
  let host = "";
  try {
    host = new URL(ref).hostname;
  } catch {
    /* not a url */
  }
  return isAiHit(ua, host);
};

async function streamToString(body) {
  const chunks = [];
  for await (const c of body) chunks.push(c);
  return Buffer.concat(chunks);
}

async function post(logs) {
  for (let i = 0; i < logs.length; i += 500) {
    await fetch(INGEST, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        brandId: BRAND,
        source: "aws_cf_s3",
        logs: logs.slice(i, i + 500),
      }),
    }).catch(() => {});
  }
}

export const handler = async (event) => {
  for (const rec of event.Records ?? []) {
    const Bucket = rec.s3.bucket.name;
    const Key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));
    const obj = await s3.send(new GetObjectCommand({ Bucket, Key }));
    const buf = await streamToString(obj.Body);
    const text = (Key.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8");

    // CloudFront standard log: tab-separated, with a "#Fields:" header naming the columns in order.
    let cols = [];
    const out = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      if (line.startsWith("#Fields:")) {
        cols = line.slice(8).trim().split(/\s+/);
        continue;
      }
      if (line.startsWith("#")) continue;
      const f = line.split("\t");
      const get = (name) => {
        const i = cols.indexOf(name);
        return i >= 0 ? f[i] : "";
      };
      const ua = dec(get("cs(User-Agent)"));
      const ref = dec(get("cs(Referer)"));
      if (!isAi(ua, ref)) continue;
      const q = get("cs-uri-query");
      out.push({
        ts: `${get("date")}T${get("time")}Z`,
        path: dec(get("cs-uri-stem")) + (q && q !== "-" ? `?${q}` : ""),
        userAgent: ua,
        referer: ref,
        status: Number(get("sc-status")) || undefined,
        ip: get("c-ip") || undefined,
      });
    }
    if (out.length) await post(out);
  }
  return { ok: true };
};
