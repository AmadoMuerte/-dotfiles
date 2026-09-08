#!/usr/bin/env bash
set -u

# OpenCode Go + Codex quota collector for Waybar / ai-quota-waybar.
#
# Output:
#   {
#     "providers": [
#       {"name":"OpenCode Go","windows":[...]},
#       {"name":"Codex","windows":[...]}
#     ],
#     "errors": []
#   }
#
# Authentication is read from the same OpenCode auth.json:
#   ${XDG_DATA_HOME:-$HOME/.local/share}/opencode/auth.json
#
# OpenCode Go can also use OPENCODE_GO_API_KEY.

AUTH_FILE="${OPENCODE_AUTH_FILE:-${XDG_DATA_HOME:-$HOME/.local/share}/opencode/auth.json}"
TIMEOUT="${AI_USAGE_TIMEOUT:-8}"
OPENCODE_GO_USAGE_URL="${OPENCODE_GO_USAGE_URL:-https://opencode.ai/zen/go/v1/usage}"
CODEX_USAGE_URL="${CODEX_USAGE_URL:-https://chatgpt.com/backend-api/wham/usage}"

command -v jq >/dev/null 2>&1 || {
  printf '{"providers":[],"errors":["jq not found"]}\n'
  exit 0
}

command -v curl >/dev/null 2>&1 || {
  printf '{"providers":[],"errors":["curl not found"]}\n'
  exit 0
}

providers='[]'
errors='[]'

add_error() {
  local message="$1"
  errors="$(jq -cn --argjson e "$errors" --arg s "$message" '$e + [$s]')"
}

add_provider() {
  local name="$1"
  local windows="$2"
  [[ "$(jq 'length' <<<"$windows")" -gt 0 ]] || return 0
  providers="$(jq -cn \
    --argjson p "$providers" \
    --arg name "$name" \
    --argjson windows "$windows" \
    '$p + [{name:$name, windows:$windows}]')"
}

clamp_pct() {
  local value="${1:-0}"
  awk -v n="$value" 'BEGIN {
    if (n < 0) n = 0
    if (n > 100) n = 100
    printf "%.1f", n
  }'
}

fmt_reset() {
  local raw="${1:-}"
  [[ -n "$raw" && "$raw" != "null" ]] || return 0

  local target now diff d h m
  now="$(date +%s)"

  if [[ "$raw" =~ ^[0-9]+$ ]]; then
    target="$raw"
    # Some APIs return milliseconds instead of seconds.
    (( target > 20000000000 )) && target=$((target / 1000))
  else
    target="$(date -d "$raw" +%s 2>/dev/null || true)"
  fi

  [[ "$target" =~ ^[0-9]+$ ]] || return 0

  diff=$((target - now))
  (( diff < 0 )) && diff=0

  d=$((diff / 86400))
  h=$(((diff % 86400) / 3600))
  m=$(((diff % 3600) / 60))

  if (( d > 0 )); then
    printf '%dd %dh' "$d" "$h"
  elif (( h > 0 )); then
    printf '%dh %dm' "$h" "$m"
  else
    printf '%dm' "$m"
  fi
}

# -----------------------------------------------------------------------------
# OpenCode Go
# -----------------------------------------------------------------------------

get_opencode_go_key() {
  if [[ -n "${OPENCODE_GO_API_KEY:-}" ]]; then
    printf '%s\n' "$OPENCODE_GO_API_KEY"
    return 0
  fi

  [[ -f "$AUTH_FILE" ]] || return 0

  jq -r '
    (
      .["opencode-go"] //
      .opencode_go //
      .opencodego //
      empty
    ) |
    .key // .apiKey // .token // .accessToken // empty
  ' "$AUTH_FILE" 2>/dev/null | head -n1
}

fetch_opencode_go() {
  local api_key tmp_body http_code raw server_message windows
  local key label limit_usd pct remaining_pct status resets_at reset
  local used_usd remaining_usd

  api_key="$(get_opencode_go_key)"
  if [[ -z "$api_key" ]]; then
    add_error 'OpenCode Go: API key not found'
    return 0
  fi

  tmp_body="$(mktemp)"
  http_code="$(
    curl -sS \
      --connect-timeout "$TIMEOUT" \
      --max-time "$TIMEOUT" \
      -o "$tmp_body" \
      -w '%{http_code}' \
      -H "Authorization: Bearer $api_key" \
      -H 'Accept: application/json' \
      -H 'User-Agent: ai-usage-waybar/opencode-go' \
      "$OPENCODE_GO_USAGE_URL" 2>/dev/null || printf '000'
  )"
  raw="$(cat "$tmp_body" 2>/dev/null || true)"
  rm -f "$tmp_body"

  if [[ "$http_code" != "200" ]]; then
    server_message="$(jq -r '.error.message // .message // empty' <<<"$raw" 2>/dev/null || true)"
    if [[ -n "$server_message" ]]; then
      add_error "OpenCode Go: HTTP $http_code: $server_message"
    elif [[ "$http_code" == "000" ]]; then
      add_error 'OpenCode Go: request failed'
    else
      add_error "OpenCode Go: HTTP $http_code"
    fi
    return 0
  fi

  if ! jq -e '
    .usage.rolling.percent != null and
    .usage.weekly.percent != null and
    .usage.monthly.percent != null
  ' >/dev/null 2>&1 <<<"$raw"; then
    add_error 'OpenCode Go: invalid usage response'
    return 0
  fi

  windows='[]'

  while IFS=$'\t' read -r key label limit_usd; do
    pct="$(jq -r --arg k "$key" '.usage[$k].percent // 0' <<<"$raw")"
    status="$(jq -r --arg k "$key" '.usage[$k].status // "ok"' <<<"$raw")"
    resets_at="$(jq -r --arg k "$key" '.usage[$k].resetsAt // ""' <<<"$raw")"

    pct="$(clamp_pct "$pct")"
    remaining_pct="$(awk -v n="$pct" 'BEGIN { printf "%.1f", 100-n }')"
    used_usd="$(awk -v p="$pct" -v l="$limit_usd" 'BEGIN { printf "%.2f", l*p/100 }')"
    remaining_usd="$(awk -v u="$used_usd" -v l="$limit_usd" 'BEGIN {
      r=l-u
      if (r < 0) r=0
      printf "%.2f", r
    }')"
    reset="$(fmt_reset "$resets_at")"

    windows="$(jq -cn \
      --argjson w "$windows" \
      --arg label "$label" \
      --arg status "$status" \
      --argjson percent "$pct" \
      --argjson remaining_percent "$remaining_pct" \
      --argjson used_usd "$used_usd" \
      --argjson remaining_usd "$remaining_usd" \
      --argjson limit_usd "$limit_usd" \
      --arg reset "$reset" \
      --arg resets_at "$resets_at" \
      '$w + [{
        label: $label,
        percent: $percent,
        remaining_percent: $remaining_percent,
        used_usd: $used_usd,
        remaining_usd: $remaining_usd,
        limit_usd: $limit_usd,
        reset: $reset,
        resets_at: $resets_at,
        status: $status
      }]')"
  done <<'LIMITS'
rolling	5h	12
weekly	weekly	30
monthly	monthly	60
LIMITS

  add_provider 'OpenCode Go' "$windows"
}

# -----------------------------------------------------------------------------
# Codex / ChatGPT account limits
# -----------------------------------------------------------------------------

fetch_codex() {
  local access account tmp_body http_code raw server_message windows
  local seconds pct reset_at label remaining_pct reset status

  [[ -f "$AUTH_FILE" ]] || {
    add_error 'Codex: OpenCode auth.json not found'
    return 0
  }

  access="$(jq -r '.openai.access // empty' "$AUTH_FILE" 2>/dev/null | head -n1)"
  account="$(jq -r '.openai.accountId // empty' "$AUTH_FILE" 2>/dev/null | head -n1)"

  if [[ -z "$access" || -z "$account" ]]; then
    add_error 'Codex: missing OpenAI auth in OpenCode'
    return 0
  fi

  tmp_body="$(mktemp)"
  http_code="$(
    curl -sS \
      --connect-timeout "$TIMEOUT" \
      --max-time "$TIMEOUT" \
      -o "$tmp_body" \
      -w '%{http_code}' \
      -H "Authorization: Bearer $access" \
      -H "ChatGPT-Account-Id: $account" \
      -H 'Accept: application/json' \
      -H 'User-Agent: ai-usage-waybar/codex' \
      "$CODEX_USAGE_URL" 2>/dev/null || printf '000'
  )"
  raw="$(cat "$tmp_body" 2>/dev/null || true)"
  rm -f "$tmp_body"

  if [[ "$http_code" != "200" ]]; then
    server_message="$(jq -r '.detail // .error.message // .message // empty' <<<"$raw" 2>/dev/null || true)"
    if [[ -n "$server_message" ]]; then
      add_error "Codex: HTTP $http_code: $server_message"
    elif [[ "$http_code" == "000" ]]; then
      add_error 'Codex: quota request failed'
    else
      add_error "Codex: HTTP $http_code"
    fi
    return 0
  fi

  if ! jq -e '.rate_limit | type == "object"' >/dev/null 2>&1 <<<"$raw"; then
    add_error 'Codex: invalid usage response'
    return 0
  fi

  windows='[]'

  while IFS=$'\t' read -r seconds pct reset_at; do
    [[ "$pct" =~ ^-?[0-9]+([.][0-9]+)?$ ]] || continue

    case "$seconds" in
      18000)  label='5h' ;;
      604800) label='weekly' ;;
      *)
        # Keep this tolerant if OpenAI slightly changes the exact window size.
        if (( seconds >= 17100 && seconds <= 18900 )); then
          label='5h'
        elif (( seconds >= 574560 && seconds <= 635040 )); then
          label='weekly'
        else
          label="$(awk -v s="$seconds" 'BEGIN {
            if (s >= 86400 && s % 86400 == 0) printf "%dd", s/86400
            else if (s >= 3600 && s % 3600 == 0) printf "%dh", s/3600
            else printf "usage"
          }')"
        fi
        ;;
    esac

    pct="$(clamp_pct "$pct")"
    remaining_pct="$(awk -v n="$pct" 'BEGIN { printf "%.1f", 100-n }')"
    reset="$(fmt_reset "$reset_at")"
    status="$(awk -v n="$pct" 'BEGIN { if (n >= 100) print "rate-limited"; else print "ok" }')"

    windows="$(jq -cn \
      --argjson w "$windows" \
      --arg label "$label" \
      --argjson percent "$pct" \
      --argjson remaining_percent "$remaining_pct" \
      --arg reset "$reset" \
      --arg resets_at "$reset_at" \
      --arg status "$status" \
      --argjson window_seconds "$seconds" \
      '$w + [{
        label: $label,
        percent: $percent,
        remaining_percent: $remaining_percent,
        reset: $reset,
        resets_at: $resets_at,
        status: $status,
        window_seconds: $window_seconds
      }]')"
  done < <(
    jq -r '
      .rate_limit |
      [.primary_window, .secondary_window][] |
      select(. != null and .used_percent != null) |
      [
        (.limit_window_seconds // 0 | tostring),
        (.used_percent | tostring),
        (.reset_at // "" | tostring)
      ] |
      @tsv
    ' <<<"$raw"
  )

  add_provider 'Codex' "$windows"
}

fetch_opencode_go
fetch_codex

jq -cn --argjson p "$providers" --argjson e "$errors" '{providers:$p, errors:$e}'
