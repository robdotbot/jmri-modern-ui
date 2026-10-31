#!/usr/bin/env bash
# Sets the code-signing secrets the release workflow reads (.github/workflows/release.yml), as
# repository secrets, and reports any that are in the wrong place or misnamed.
#
#   scripts/set-signing-secrets.sh            # check, then set the Mac and/or Windows secrets
#   scripts/set-signing-secrets.sh --check    # only report what is set where
#
# Needs the GitHub CLI (https://cli.github.com), logged in with `gh auth login`.
# Values are sent to GitHub through stdin, never on a command line.
set -uo pipefail

REPO=${REPO:-robdotbot/jmri-modern-ui}
MAC_SECRETS=(MACOS_INSTALLER_P12_BASE64 MACOS_INSTALLER_P12_PASSWORD APPLE_ID APPLE_APP_PASSWORD APPLE_TEAM_ID)
WIN_PFX_SECRETS=(WINDOWS_CERT_PFX_BASE64 WINDOWS_CERT_PASSWORD)
WIN_AZURE_SECRETS=(AZURE_TENANT_ID AZURE_CLIENT_ID AZURE_CLIENT_SECRET)
WIN_AZURE_VARS=(TRUSTED_SIGNING_ENDPOINT TRUSTED_SIGNING_ACCOUNT TRUSTED_SIGNING_PROFILE)
ALL=("${MAC_SECRETS[@]}" "${WIN_PFX_SECRETS[@]}" "${WIN_AZURE_SECRETS[@]}" "${WIN_AZURE_VARS[@]}")

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
ok() { printf '\033[32m✓ %s\033[0m\n' "$*"; }

command -v gh >/dev/null || { echo "Install the GitHub CLI first: https://cli.github.com" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Log in first: gh auth login" >&2; exit 1; }
gh repo view "$REPO" >/dev/null || { echo "Can't open $REPO with your GitHub login." >&2; exit 1; }

# ---- Check ----------------------------------------------------------------------------------
bold "Signing settings on $REPO"
repo_secrets=$(gh secret list -R "$REPO" --json name -q '.[].name' || true)
repo_vars=$(gh variable list -R "$REPO" --json name -q '.[].name' || true)
has() { grep -qx "$1" <<<"$2"; }

check_group() { # <label> <list> <names...>
  local label=$1 list=$2 n missing=()
  shift 2
  for n in "$@"; do has "$n" "$list" || missing+=("$n"); done
  if [ ${#missing[@]} -eq 0 ]; then ok "$label: all set"; else echo "  $label missing: ${missing[*]}"; fi
}
check_group "Mac (repository secrets)" "$repo_secrets" "${MAC_SECRETS[@]}"
check_group "Windows .pfx (repository secrets)" "$repo_secrets" "${WIN_PFX_SECRETS[@]}"
check_group "Windows Azure (repository secrets)" "$repo_secrets" "${WIN_AZURE_SECRETS[@]}"
check_group "Windows Azure (repository variables)" "$repo_vars" "${WIN_AZURE_VARS[@]}"

# Signing values that the workflow can't see: wrong case, wrong kind, or in an environment.
for n in $repo_secrets $repo_vars; do
  for want in "${ALL[@]}"; do
    if [ "$n" != "$want" ] && [ "$(tr '[:lower:]' '[:upper:]' <<<"$n")" = "$want" ]; then
      warn "\"$n\" should be named exactly \"$want\" (names are case-sensitive)"
    fi
  done
done
for want in "${WIN_AZURE_VARS[@]}"; do
  has "$want" "$repo_secrets" && warn "$want is a secret; the workflow reads it as a variable (Variables tab)"
done
for want in "${MAC_SECRETS[@]}" "${WIN_PFX_SECRETS[@]}" "${WIN_AZURE_SECRETS[@]}"; do
  has "$want" "$repo_vars" && warn "$want is a variable; it must be a secret"
done
envs=$(gh api "repos/$REPO/environments" -q '.environments[].name' 2>/dev/null || true)
while IFS= read -r env; do
  [ -n "$env" ] || continue
  env_secrets=$(gh secret list -R "$REPO" --env "$env" --json name -q '.[].name' || true)
  for want in "${ALL[@]}"; do
    has "$want" "$env_secrets" && warn "$want is in the \"$env\" environment, which the workflow doesn't use; it must be a repository secret"
  done
done <<<"$envs"
for app in dependabot codespaces; do
  other=$(gh secret list -R "$REPO" --app "$app" --json name -q '.[].name' 2>/dev/null || true)
  for want in "${ALL[@]}"; do
    has "$want" "$other" && warn "$want is a $app secret; Actions can't read it, it must be an Actions repository secret"
  done
done

[ "${1:-}" = --check ] && exit 0

# ---- Set ------------------------------------------------------------------------------------
put_secret() { printf '%s' "$2" | gh secret set "$1" -R "$REPO" >/dev/null && ok "set secret $1"; }
put_var() { gh variable set "$1" -R "$REPO" --body "$2" >/dev/null && ok "set variable $1"; }
ask() { local v; read -r -p "$1: " v; printf '%s' "$v"; }
ask_secret() { local v; read -r -s -p "$1: " v; echo >&2; printf '%s' "$v"; }
file_b64() { base64 <"$1" | tr -d '\n'; }

echo
read -r -p "Set the Mac signing secrets now? [y/N] " a
if [[ $a =~ ^[Yy] ]]; then
  p12=$(ask "Path to the Developer ID Installer .p12 (exported from Keychain Access)")
  p12=${p12/#\~/$HOME}
  [ -f "$p12" ] || { echo "No file at $p12" >&2; exit 1; }
  p12pw=$(ask_secret "Password of the .p12")
  subject=$(openssl pkcs12 -in "$p12" -nokeys -passin fd:3 3<<<"$p12pw" 2>/dev/null | openssl x509 -noout -subject 2>/dev/null ||
    openssl pkcs12 -legacy -in "$p12" -nokeys -passin fd:3 3<<<"$p12pw" 2>/dev/null | openssl x509 -noout -subject 2>/dev/null || true)
  if [ -z "$subject" ]; then
    warn "Couldn't read the .p12 to check it (wrong password, or an openssl that can't read it)"
  elif [[ $subject != *"Developer ID Installer"* ]]; then
    warn "This certificate isn't a \"Developer ID Installer\" one: $subject"
    warn "Packages need Developer ID Installer (Developer ID Application is for apps)."
  else
    ok "certificate: $subject"
  fi
  apple_id=$(ask "Apple ID (email) of the developer account")
  app_pw=$(ask_secret "App-specific password for it (appleid.apple.com → Sign-In and Security)")
  [[ $app_pw =~ ^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$ ]] || warn "App-specific passwords look like abcd-efgh-ijkl-mnop; your normal Apple ID password won't work"
  team=$(ask "Team ID (10 characters, Membership details in the developer account)")
  [[ $team =~ ^[A-Z0-9]{10}$ ]] || warn "A team ID is 10 capital letters and digits, e.g. AB12CD34EF"
  put_secret MACOS_INSTALLER_P12_BASE64 "$(file_b64 "$p12")"
  put_secret MACOS_INSTALLER_P12_PASSWORD "$p12pw"
  put_secret APPLE_ID "$apple_id"
  put_secret APPLE_APP_PASSWORD "$app_pw"
  put_secret APPLE_TEAM_ID "$team"
fi

echo
echo "Windows signing: 1) a .pfx certificate file  2) Azure Trusted Signing  3) skip"
read -r -p "Choice [3]: " w
case "${w:-3}" in
  1)
    pfx=$(ask "Path to the .pfx file")
    pfx=${pfx/#\~/$HOME}
    [ -f "$pfx" ] || { echo "No file at $pfx" >&2; exit 1; }
    pfxpw=$(ask_secret "Password of the .pfx")
    put_secret WINDOWS_CERT_PFX_BASE64 "$(file_b64 "$pfx")"
    put_secret WINDOWS_CERT_PASSWORD "$pfxpw"
    ;;
  2)
    put_secret AZURE_TENANT_ID "$(ask "Directory (tenant) ID of the app registration")"
    put_secret AZURE_CLIENT_ID "$(ask "Application (client) ID")"
    put_secret AZURE_CLIENT_SECRET "$(ask_secret "Client secret value")"
    put_var TRUSTED_SIGNING_ENDPOINT "$(ask "Endpoint host, e.g. eus.codesigning.azure.net")"
    put_var TRUSTED_SIGNING_ACCOUNT "$(ask "Trusted Signing account name")"
    put_var TRUSTED_SIGNING_PROFILE "$(ask "Certificate profile name")"
    ;;
esac

echo
read -r -p "Run the workflow on main now to test signing (publishes nothing)? [Y/n] " a
if [[ ! $a =~ ^[Nn] ]]; then
  gh workflow run release.yml -R "$REPO" --ref main
  ok "started; follow it with: gh run watch -R $REPO \$(gh run list -R $REPO -w release.yml -L1 --json databaseId -q '.[0].databaseId')"
fi
