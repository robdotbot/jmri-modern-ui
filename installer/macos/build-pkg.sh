#!/bin/bash
# Builds the macOS installer package (run on a Mac; used by .github/workflows/release.yml).
#   installer/macos/build-pkg.sh <version> <app dir> <out.pkg> [add-on jar]
# With MACOS_INSTALLER_IDENTITY set (a "Developer ID Installer: …" identity in the keychain, or
# MACOS_KEYCHAIN), the package is signed. Notarizing it is a separate step (see release.yml).
set -euo pipefail
version=$1 app=$2 out=$3 jar=${4:-}
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

root="$work/root/Library/Application Support/JMRI Modern UI"
mkdir -p "$root/web"
cp -R "$app" "$root/web/modern"
cp "$here/uninstall.sh" "$root/"
if [ -n "$jar" ]; then cp "$jar" "$root/"; fi

pkgbuild --root "$work/root" --install-location / --scripts "$here/scripts" \
  --identifier org.jmri.modernui --version "$version" "$work/component.pkg"

mkdir -p "$work/resources"
sed "s/@VERSION@/$version/g" "$here/welcome.html" > "$work/resources/welcome.html"
cp "$here/conclusion.html" "$work/resources/"
cat > "$work/distribution.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>JMRI Modern UI $version</title>
  <welcome file="welcome.html" mime-type="text/html"/>
  <conclusion file="conclusion.html" mime-type="text/html"/>
  <options customize="never" require-scripts="false" hostArchitectures="arm64,x86_64"/>
  <domains enable_localSystem="true"/>
  <choices-outline><line choice="default"/></choices-outline>
  <choice id="default" title="JMRI Modern UI"><pkg-ref id="org.jmri.modernui"/></choice>
  <pkg-ref id="org.jmri.modernui" version="$version">component.pkg</pkg-ref>
</installer-gui-script>
XML
sign=()
if [ -n "${MACOS_INSTALLER_IDENTITY:-}" ]; then
  sign=(--sign "$MACOS_INSTALLER_IDENTITY" --timestamp)
  if [ -n "${MACOS_KEYCHAIN:-}" ]; then sign+=(--keychain "$MACOS_KEYCHAIN"); fi
fi
productbuild --distribution "$work/distribution.xml" --resources "$work/resources" --package-path "$work" ${sign[@]+"${sign[@]}"} "$out"
echo "Built $out"
