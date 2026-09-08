#!/usr/bin/env bash
set -u

# Waybar formatter for OpenCode Go + Codex usage.
# Expects ai-usage-collector.sh in the same directory unless overridden with
# AI_USAGE_COLLECTOR=/path/to/ai-usage-collector.sh.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COLLECTOR="${AI_USAGE_COLLECTOR:-$SCRIPT_DIR/ai-usage-collector.sh}"

# Used together with `"signal": 8` in the Waybar custom module.
if [[ "${1:-}" == "--refresh" ]]; then
  pkill -RTMIN+8 waybar 2>/dev/null || true
  exit 0
fi

fallback() {
  local message="$1"
  jq -cn --arg text '󰚩 AI ?' --arg tooltip "$message" \
    '{text:$text, tooltip:$tooltip, class:"error", percentage:0}'
}

if ! command -v jq >/dev/null 2>&1; then
  printf '{"text":"AI ?","tooltip":"jq not found","class":"error","percentage":0}\n'
  exit 0
fi

if [[ ! -x "$COLLECTOR" ]]; then
  fallback "Quota collector not executable: $COLLECTOR"
  exit 0
fi

raw="$($COLLECTOR 2>/dev/null || true)"

if ! jq -e '.providers | type == "array"' >/dev/null 2>&1 <<<"$raw"; then
  fallback 'Quota collector returned invalid JSON'
  exit 0
fi

# In the bar, show the tightest remaining window for each provider.
text="$(jq -r '
  [.providers[] |
    . as $provider |
    ([.windows[]?.remaining_percent | tonumber?] | min) as $remaining |
    select($remaining != null) |
    if .name == "OpenCode Go" then "Go \($remaining | floor)%"
    elif .name == "Codex" then "Codex \($remaining | floor)%"
    else "\(.name) \($remaining | floor)%"
    end
  ] |
  if length > 0 then "󰚩 " + join(" · ") else "󰚩 AI ?" end
' <<<"$raw")"

tooltip="$(jq -r '
  def pct:
    (tonumber? // 0) |
    if (floor == .) then tostring else ((.*10 | round) / 10 | tostring) end;

  def provider_block:
    .name + "\n" +
    (.windows | map(
      "  " + .label + ": " + ((.remaining_percent // (100 - (.percent // 0))) | pct) + "% left" +
      (if (.used_usd? != null and .limit_usd? != null)
       then " · $" + (.used_usd | tostring) + "/$" + (.limit_usd | tostring)
       else ""
       end) +
      (if ((.reset // "") | length) > 0 then " · reset " + .reset else "" end)
    ) | join("\n"));

  ([.providers[] | provider_block] | join("\n\n")) as $providers |
  ([.errors[]? | select(length > 0)] | join("\n")) as $errors |
  if ($providers | length) > 0 and ($errors | length) > 0 then
    $providers + "\n\nErrors\n" + $errors
  elif ($providers | length) > 0 then
    $providers
  elif ($errors | length) > 0 then
    "Quota errors\n" + $errors
  else
    "No quota data"
  end
' <<<"$raw")"

min_remaining="$(jq -r '[.providers[].windows[]?.remaining_percent | tonumber?] | min // 0' <<<"$raw")"

class="normal"
if awk -v n="$min_remaining" 'BEGIN { exit !(n <= 10) }'; then
  class="critical"
elif awk -v n="$min_remaining" 'BEGIN { exit !(n <= 25) }'; then
  class="warning"
fi

percentage="$(awk -v n="$min_remaining" 'BEGIN {
  if (n < 0) n = 0;
  if (n > 100) n = 100;
  printf "%.0f", n
}')"

jq -cn \
  --arg text "$text" \
  --arg tooltip "$tooltip" \
  --arg class "$class" \
  --argjson percentage "$percentage" \
  '{text:$text, tooltip:$tooltip, class:$class, percentage:$percentage}'
