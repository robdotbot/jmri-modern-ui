#!/bin/bash
# Signs a Windows executable with jsign (https://ebourg.github.io/jsign/). makensis calls it for the
# installer and its uninstaller (see !finalize in installer.nsi); it also works on its own:
#   installer/windows/sign.sh <file.exe>
#
# Configure one of these through the environment:
#   Azure Trusted Signing (Artifact Signing):
#     TRUSTED_SIGNING_ENDPOINT   e.g. eus.codesigning.azure.net
#     TRUSTED_SIGNING_ACCOUNT    the signing account name
#     TRUSTED_SIGNING_PROFILE    the certificate profile name
#     TRUSTED_SIGNING_TOKEN      an access token for https://codesigning.azure.net
#   A certificate in a .pfx/.p12 file:
#     WINDOWS_CERT_FILE          path to the file
#     WINDOWS_CERT_PASSWORD      its password
# JSIGN_JAR is the jsign jar (default: jsign.jar next to this script).
# TIMESTAMP_URL overrides the timestamp server; "none" skips timestamping (for local tests only:
# without a timestamp the signature stops being valid when the certificate expires).
set -euo pipefail
file=$1
jar=${JSIGN_JAR:-$(dirname "$0")/jsign.jar}
tsa() { if [ "${TIMESTAMP_URL:-}" = none ]; then :; else echo "--tsaurl ${TIMESTAMP_URL:-$1} --tsmode RFC3161"; fi; }
common=(--name "JMRI Modern UI" --url "https://github.com/robdotbot/jmri-modern-ui" --alg SHA-256 --replace)

if [ -n "${TRUSTED_SIGNING_TOKEN:-}" ]; then
  java -jar "$jar" "${common[@]}" --storetype TRUSTEDSIGNING \
    --keystore "$TRUSTED_SIGNING_ENDPOINT" --storepass env:TRUSTED_SIGNING_TOKEN \
    --alias "$TRUSTED_SIGNING_ACCOUNT/$TRUSTED_SIGNING_PROFILE" \
    $(tsa http://timestamp.acs.microsoft.com/) "$file"
elif [ -n "${WINDOWS_CERT_FILE:-}" ]; then
  java -jar "$jar" "${common[@]}" --storetype PKCS12 \
    --keystore "$WINDOWS_CERT_FILE" --storepass env:WINDOWS_CERT_PASSWORD \
    $(tsa http://timestamp.digicert.com) "$file"
else
  echo "sign.sh: no signing configuration; $file left unsigned" >&2
  exit 1
fi
