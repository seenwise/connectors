// GENERATED — do not edit. CommonJS mirror of bots.js. Source: monorepo packages/scan-core/src/bots.ts.
const BOT = /ChatGPT-User|OAI-SearchBot|GPTBot|Perplexity-User|PerplexityBot|Claude-User|Claude-SearchBot|ClaudeBot|anthropic-ai|Google-NotebookLM|Google-Read-Aloud|Google-?Agent|Grok-DeepSearch|xAI-SearchBot|xAI-Web-Crawler|GrokBot|MistralAI-User|MistralAI-Index|\bCopilot\/|Bingbot|msnbot|DuckAssistBot|Bytespider|Amazonbot|Meta-ExternalFetcher|Meta-ExternalAgent/i;
const REF = /(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|gemini\.google\.com|bard\.google\.com|claude\.ai|copilot\.microsoft\.com|grok\.com|meta\.ai|chat\.mistral\.ai|chat\.deepseek\.com|you\.com|poe\.com|phind\.com)$/i;
function isAiHit(userAgent = '', refererHost = '') {
  return BOT.test(userAgent) || REF.test(refererHost);
}
module.exports = { BOT, REF, isAiHit };
