#!/usr/bin/env bash
# Prints a one-hour installation token for the gleam-triage GitHub App.
#
#   GH_TOKEN=$(scripts/bot-token.sh) gh pr comment 123 --body "…"
#
# The app's private key stays inside the KeePassXC database: it is piped to
# openssl through a file descriptor and never written to disk. keepassxc-cli
# the script asks for the database password on the terminal, so Will has to be
# present.
#
# Config (environment, never committed):
#   GLEAM_CWS_KDBX            database path (default ~/.secrets/gleam-cws/gleam-cws.kdbx)
#   GLEAM_BOT_APP_ID          GitHub App ID
#   GLEAM_BOT_INSTALLATION_ID installation ID
#   GLEAM_BOT_ENTRY           entry title (default "gleam-triage GitHub App")

set -euo pipefail

kdbx="${GLEAM_CWS_KDBX:-$HOME/.secrets/gleam-cws/gleam-cws.kdbx}"
app_id="${GLEAM_BOT_APP_ID:?set GLEAM_BOT_APP_ID}"
installation_id="${GLEAM_BOT_INSTALLATION_ID:?set GLEAM_BOT_INSTALLATION_ID}"
entry="${GLEAM_BOT_ENTRY:-gleam-triage GitHub App}"

for tool in keepassxc-cli openssl curl node; do
  command -v "$tool" > /dev/null || { echo "$tool not found" >&2; exit 2; }
done

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# iat is backdated 60s for clock skew; GitHub caps the JWT at 10 minutes.
now=$(date +%s)
header=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
payload=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$((now - 60))" "$((now + 540))" "$app_id" | b64url)
unsigned="$header.$payload"

# A process substitution runs with stdin on /dev/null, so keepassxc-cli can't
# prompt inside it; the password is read here and handed over on stdin.
read -r -s -p "KeePassXC password: " db_password < /dev/tty
echo >&2

signature=$(printf '%s' "$unsigned" | openssl dgst -sha256 -sign <(
  printf '%s\n' "$db_password" | keepassxc-cli attachment-export -q "$kdbx" "$entry" app.pem --stdout
) | b64url)
unset db_password

response=$(curl -fsS -X POST \
  -H "Authorization: Bearer $unsigned.$signature" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/app/installations/$installation_id/access_tokens")

printf '%s' "$response" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).token)'
