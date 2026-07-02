// Smoke test for the published connectors repo — runs with zero deps: `node --test`.
// Proves the generated bot filter works; the monorepo owns the full drift/parity guard.
import assert from "node:assert/strict";
import { test } from "node:test";

import { isAiHit } from "../lib/bots.js";

test("detects AI crawlers by User-Agent", () => {
  assert.equal(isAiHit("Mozilla/5.0 (compatible; GPTBot/1.1)"), true);
  assert.equal(isAiHit("ChatGPT-User/1.0"), true);
  assert.equal(isAiHit("Grok-DeepSearch"), true);
  assert.equal(isAiHit("MistralAI-User/1.0"), true);
});

test("detects AI referrals by Referer host", () => {
  assert.equal(isAiHit("", "chatgpt.com"), true);
  assert.equal(isAiHit("", "www.perplexity.ai"), true);
});

test("ignores ordinary human traffic", () => {
  assert.equal(
    isAiHit("Mozilla/5.0 (Macintosh) Safari/605.1.15", "google.com"),
    false,
  );
});
