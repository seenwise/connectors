#!/usr/bin/env bash
# =============================================================================
# Seenwise — Google Cloud (HTTP Load Balancer / Cloud CDN) async connector.
# Forwards AI bot crawls + AI referral visits from your Load Balancer access logs
# to Seenwise. No inline latency (runs off the log stream), complete coverage.
#
#   LB access logs → Cloud Logging sink (AI-only filter) → Pub/Sub → Cloud Function
#   → POST https://api.tryseenwise.com/ingest  (source: gcp_lb)
#
# Run in Cloud Shell. Required env (or edit the defaults below):
#   SEENWISE_BRAND       your Seenwise brand id
#   SEENWISE_INGEST_KEY  your Seenwise ingest key (ik_…)
#   REGION               GCP region for the function, e.g. europe-west1
# Prompts for: URL_MAP_NAME (your Load Balancer URL map).
# =============================================================================
set -euo pipefail

INGEST_URL="${SEENWISE_INGEST_URL:-https://api.tryseenwise.com/ingest}"
BRAND="${SEENWISE_BRAND:?set SEENWISE_BRAND}"
KEY="${SEENWISE_INGEST_KEY:?set SEENWISE_INGEST_KEY}"
REGION="${REGION:-europe-west1}"

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
[ -z "$PROJECT_ID" ] && { echo "No active GCP project. Run: gcloud config set project YOUR_PROJECT"; exit 1; }
read -rp "Cloud Load Balancer URL map name: " URL_MAP_NAME
[ -z "$URL_MAP_NAME" ] && { echo "URL map name is required."; exit 1; }

TOPIC="seenwise-ai-logs"; SINK="seenwise-ai-sink"; SA="seenwise-log-processor"
SA_EMAIL="${SA}@${PROJECT_ID}.iam.gserviceaccount.com"; FUNCTION="seenwise-log-processor"

# Match the same AI bots + referers the rest of the connectors do (see attribution.util.ts).
BOT='GPTBot|OAI-SearchBot|ChatGPT-User|PerplexityBot|Perplexity-User|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|Google-Extended|Bytespider|Amazonbot'
REF='chatgpt[.]com|chat[.]openai[.]com|perplexity[.]ai|gemini[.]google[.]com|claude[.]ai|copilot[.]microsoft[.]com|you[.]com|poe[.]com|phind[.]com'

echo "▶ Enabling APIs…"
gcloud services enable pubsub.googleapis.com cloudfunctions.googleapis.com cloudbuild.googleapis.com \
  logging.googleapis.com run.googleapis.com artifactregistry.googleapis.com --project="$PROJECT_ID" --quiet

echo "▶ Pub/Sub topic…"
gcloud pubsub topics describe "$TOPIC" --project="$PROJECT_ID" &>/dev/null || \
  gcloud pubsub topics create "$TOPIC" --project="$PROJECT_ID"
TOPIC_RES="projects/${PROJECT_ID}/topics/${TOPIC}"

echo "▶ Log sink (AI-only filter — exports just the requests we care about)…"
# The =~ regex match keeps Pub/Sub volume (and cost) tiny: only AI bots / AI referrers are exported.
FILTER="resource.type=\"http_load_balancer\" AND resource.labels.url_map_name=\"${URL_MAP_NAME}\" AND (httpRequest.userAgent=~\"${BOT}\" OR httpRequest.referer=~\"${REF}\")"
if gcloud logging sinks describe "$SINK" --project="$PROJECT_ID" &>/dev/null; then
  gcloud logging sinks update "$SINK" "pubsub.googleapis.com/${TOPIC_RES}" --log-filter="$FILTER" --project="$PROJECT_ID"
else
  gcloud logging sinks create "$SINK" "pubsub.googleapis.com/${TOPIC_RES}" --log-filter="$FILTER" --project="$PROJECT_ID"
fi
SINK_SA=$(gcloud logging sinks describe "$SINK" --project="$PROJECT_ID" --format="value(writerIdentity)")
gcloud pubsub topics add-iam-policy-binding "$TOPIC" --project="$PROJECT_ID" --member="$SINK_SA" --role="roles/pubsub.publisher" --quiet

echo "▶ Service account…"
gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" &>/dev/null || \
  gcloud iam service-accounts create "$SA" --display-name="Seenwise Log Processor" --project="$PROJECT_ID"

echo "▶ Cloud Function source…"
FUNC_DIR=$(mktemp -d); trap 'rm -rf "$FUNC_DIR"' EXIT
cat > "$FUNC_DIR/package.json" <<'EOF'
{ "name": "seenwise-log-processor", "version": "1.0.0", "main": "index.js", "type": "module" }
EOF
cat > "$FUNC_DIR/index.js" <<FUNCEOF
const INGEST='${INGEST_URL}', BRAND='${BRAND}', KEY='${KEY}';
const BOT=/${BOT}/i;
const REF=/(^|\\.)(chatgpt\\.com|chat\\.openai\\.com|perplexity\\.ai|gemini\\.google\\.com|claude\\.ai|copilot\\.microsoft\\.com|you\\.com|poe\\.com|phind\\.com)$/i;
// Triggered per Pub/Sub message (one LB log entry). The sink already filtered to AI traffic;
// we re-check defensively, reshape, and POST one batch to Seenwise.
export const processLog = async (message) => {
  let e; try { e = JSON.parse(Buffer.from(message.data, 'base64').toString('utf8')); } catch { return; }
  const r = e.httpRequest; if (!r) return;
  const ua = r.userAgent || '', ref = r.referer || '';
  let host=''; try { host = new URL(ref).hostname; } catch {}
  if (!(BOT.test(ua) || REF.test(host))) return;
  let path=''; try { const u=new URL(r.requestUrl||''); path=u.pathname+u.search; } catch { path = r.requestUrl||'/'; }
  await fetch(INGEST, { method:'POST',
    headers:{ 'content-type':'application/json', authorization:'Bearer '+KEY },
    body: JSON.stringify({ brandId: BRAND, source:'gcp_lb', logs:[{
      ts: e.timestamp || new Date().toISOString(), path, userAgent: ua, referer: ref,
      status: r.status ? Number(r.status) : undefined, ip: r.remoteIp || undefined }] }) }).catch(()=>{});
};
FUNCEOF

echo "▶ Deploying function…"
gcloud functions deploy "$FUNCTION" --gen2 --runtime=nodejs22 --region="$REGION" --source="$FUNC_DIR" \
  --entry-point=processLog --trigger-topic="$TOPIC" --service-account="$SA_EMAIL" --project="$PROJECT_ID" --quiet

echo ""
echo "✓ Seenwise Google Cloud connector is live. AI traffic on $URL_MAP_NAME now flows to Seenwise."
