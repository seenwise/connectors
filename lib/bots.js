// GENERATED — do not edit. Single source: seenwise monorepo packages/scan-core/src/bots.ts.
// This file is published to github.com/seenwise/connectors by CI; every artifact imports it.
export const BOT = /ChatGPT-User|OAI-SearchBot|GPTBot|Perplexity-User|PerplexityBot|Claude-User|Claude-SearchBot|ClaudeBot|anthropic-ai|Google-NotebookLM|Google-Read-Aloud|Google-?Agent|Grok-DeepSearch|xAI-SearchBot|xAI-Web-Crawler|GrokBot|MistralAI-User|MistralAI-Index|\bCopilot\/|Bingbot|msnbot|DuckAssistBot|Bytespider|Amazonbot|Meta-ExternalAgent/i;
export const REF = /(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|gemini\.google\.com|bard\.google\.com|claude\.ai|copilot\.microsoft\.com|you\.com|poe\.com|phind\.com)$/i;

// True when a request looks AI-related (a bot User-Agent, or an AI-answer Referer host). This is
// only an edge pre-filter — the Seenwise ingest server always re-validates.
export function isAiHit(userAgent = '', refererHost = '') {
  return BOT.test(userAgent) || REF.test(refererHost);
}
