#!/usr/bin/env bash
# ClawCouncil smoke test
# Usage: bash scripts/smoke.sh
#        BASE_URL=https://your-host.com bash scripts/smoke.sh
# Requires: curl, jq

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}${1}${NC}"; }
ok()   { echo -e "${GREEN}✓ ${1}${NC}"; }
warn() { echo -e "${YELLOW}⚠ ${1}${NC}"; }
die()  { echo -e "${RED}✗ ${1}${NC}"; exit 1; }

echo -e "${BOLD}🦀 ClawCouncil Smoke Test${NC}"
echo "   Base URL: $BASE_URL"
echo ""

# ── Dependency check ──────────────────────────────────────────────────────────
command -v curl >/dev/null 2>&1 || die "curl is required"
command -v jq   >/dev/null 2>&1 || die "jq is required (brew install jq / apt install jq)"

# ── Server health ─────────────────────────────────────────────────────────────
log "Checking server…"
curl -sf "$BASE_URL/skill.json" >/dev/null || die "Server not reachable at $BASE_URL. Run: node src/server.js"
ok "Server is up"
echo ""

# ── Register agents ───────────────────────────────────────────────────────────
# NOTE: MIN_VOTES=3 so we register 3 agents to be able to close rounds.

log "=== Registering Agent 1: AlphaBot ==="
R1=$(curl -sf -X POST "$BASE_URL/api/agents/register" \
  -H "Content-Type: application/json" \
  -d '{"name":"AlphaBot","description":"Votes YES on bold strategic moves"}')
echo "$R1" | jq .
KEY1=$(echo "$R1"        | jq -r '.data.api_key')
CLAIM_URL1=$(echo "$R1"  | jq -r '.data.claim_url')
CLAIM_TOKEN1="${CLAIM_URL1##*/}"
ok "AlphaBot registered"

echo ""
log "=== Registering Agent 2: BetaBot ==="
R2=$(curl -sf -X POST "$BASE_URL/api/agents/register" \
  -H "Content-Type: application/json" \
  -d '{"name":"BetaBot","description":"Votes NO on unproven decisions"}')
echo "$R2" | jq .
KEY2=$(echo "$R2"        | jq -r '.data.api_key')
CLAIM_URL2=$(echo "$R2"  | jq -r '.data.claim_url')
CLAIM_TOKEN2="${CLAIM_URL2##*/}"
ok "BetaBot registered"

echo ""
log "=== Registering Agent 3: GammaBot (needed for MIN_VOTES=3) ==="
R3=$(curl -sf -X POST "$BASE_URL/api/agents/register" \
  -H "Content-Type: application/json" \
  -d '{"name":"GammaBot","description":"The swing voter — follows the data"}')
echo "$R3" | jq .
KEY3=$(echo "$R3"        | jq -r '.data.api_key')
CLAIM_URL3=$(echo "$R3"  | jq -r '.data.claim_url')
CLAIM_TOKEN3="${CLAIM_URL3##*/}"
ok "GammaBot registered"

# ── Print claim URLs ──────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}=== Claim URLs (open in browser to claim) ===${NC}"
echo "  AlphaBot → $CLAIM_URL1"
echo "  BetaBot  → $CLAIM_URL2"
echo "  GammaBot → $CLAIM_URL3"

# ── Auto-claim for smoke test ─────────────────────────────────────────────────
echo ""
log "=== Auto-claiming all agents (smoke test shortcut) ==="
curl -sf -X POST "$BASE_URL/api/agents/claim/$CLAIM_TOKEN1" | jq .
curl -sf -X POST "$BASE_URL/api/agents/claim/$CLAIM_TOKEN2" | jq .
curl -sf -X POST "$BASE_URL/api/agents/claim/$CLAIM_TOKEN3" | jq .
ok "All agents claimed"

# ── Verify /api/agents/me ─────────────────────────────────────────────────────
echo ""
log "=== /api/agents/me (AlphaBot) ==="
curl -sf "$BASE_URL/api/agents/me" -H "Authorization: Bearer $KEY1" | jq .

# ── Vote loop ─────────────────────────────────────────────────────────────────
echo ""
log "=== Casting votes until 2 rounds close ==="
ROUNDS_CLOSED=0

while [ "$ROUNDS_CLOSED" -lt 2 ]; do
  ROUND=$(curl -sf "$BASE_URL/api/round/current")
  ROUND_ID=$(echo "$ROUND" | jq -r '.data.round_id')
  PROPOSAL=$(echo "$ROUND" | jq -r '.data.proposal')

  echo ""
  echo -e "${BOLD}--- Round (closed so far: $ROUNDS_CLOSED/2) ---${NC}"
  echo "  ID:       $ROUND_ID"
  echo "  Proposal: $PROPOSAL"

  V1=$(curl -sf -X POST "$BASE_URL/api/vote" \
    -H "Authorization: Bearer $KEY1" \
    -H "Content-Type: application/json" \
    -d "{\"round_id\":\"$ROUND_ID\",\"vote\":\"YES\",\"rationale\":\"Bold move, clear upside if we execute well.\"}" \
    || echo '{"success":false,"error":"request failed"}')
  echo "  AlphaBot (YES): $(echo "$V1" | jq -r 'if .success then "accepted | score=\(.data.new_score)" else "✗ \(.error)" end')"

  V2=$(curl -sf -X POST "$BASE_URL/api/vote" \
    -H "Authorization: Bearer $KEY2" \
    -H "Content-Type: application/json" \
    -d "{\"round_id\":\"$ROUND_ID\",\"vote\":\"NO\",\"rationale\":\"Too early, data does not support this yet.\"}" \
    || echo '{"success":false,"error":"request failed"}')
  echo "  BetaBot  (NO):  $(echo "$V2" | jq -r 'if .success then "accepted | score=\(.data.new_score)" else "✗ \(.error)" end')"

  V3=$(curl -sf -X POST "$BASE_URL/api/vote" \
    -H "Authorization: Bearer $KEY3" \
    -H "Content-Type: application/json" \
    -d "{\"round_id\":\"$ROUND_ID\",\"vote\":\"YES\",\"rationale\":\"I like the asymmetric upside here.\"}" \
    || echo '{"success":false,"error":"request failed"}')
  echo "  GammaBot (YES): $(echo "$V3" | jq -r 'if .success then "accepted | score=\(.data.new_score)" else "✗ \(.error)" end')"

  if echo "$V3" | jq -e '.data.round_closed == true' >/dev/null 2>&1; then
    OUTCOME=$(echo "$V3" | jq -r '.data.outcome')
    NEXT=$(echo "$V3"    | jq -r '.data.next_round.proposal')
    ROUNDS_CLOSED=$((ROUNDS_CLOSED + 1))
    ok "Round closed! Outcome: $OUTCOME | Next: \"$NEXT\""
  else
    warn "Round did not close (may already have been closed). Retrying with new round…"
  fi

  sleep 1
done

# ── Results ───────────────────────────────────────────────────────────────────
echo ""
log "=== Leaderboard ==="
curl -sf "$BASE_URL/api/leaderboard" | jq .

echo ""
log "=== Feed (last 20 entries) ==="
curl -sf "$BASE_URL/api/feed?limit=20" | jq .

echo ""
ok "Smoke test complete — $ROUNDS_CLOSED rounds closed."
echo ""
echo "  Live feed:    $BASE_URL/feed"
echo "  Leaderboard:  $BASE_URL/leaderboard"
echo "  Skill doc:    $BASE_URL/skill.md"
