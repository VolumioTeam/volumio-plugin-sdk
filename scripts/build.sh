#!/usr/bin/env bash
# Builds a plugin for one architecture in the Volumio build container (Debian Bookworm, Node 20),
# exactly as the reusable workflow does. Usage: [REPORT_ONLY=true] scripts/build.sh <plugin-dir> <arch> [out-dir]
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: $0 <plugin-dir> <arch> [out-dir]" >&2
  exit 2
fi
plugin=$(cd "$1" && pwd)
arch=$2
out=${3:-dist-plugin}
sdk=$(cd "$(dirname "$0")/.." && pwd)
# Debian Bookworm, Node 20, pinned by digest: bump it on purpose, never by accident.
IMAGE=node:20-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5

case $arch in
  armhf) platform=linux/arm/v7 ;;
  amd64) platform=linux/amd64 ;;
  arm64) platform=linux/arm64 ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 2 ;;
esac

# The commit time keeps the zip reproducible.
SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git -C "$plugin" log -1 --format=%ct)}
export SOURCE_DATE_EPOCH
mkdir -p "$out"

# REPORT_ONLY=true: gate errors are reported, not fatal (volumio-plugin package --report-only).
package_args=(--out /out)
if [ "${REPORT_ONLY:-false}" = true ]; then package_args+=(--report-only); fi

# On GitHub, what package prints (the gate findings, the zip, its sha256) also goes to the run summary.
log=$(mktemp)
summary() {
  local status=$?
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      printf '### %s (%s)\n\n' "$(basename "$plugin")" "$arch"
      if [ "$status" -ne 0 ]; then printf 'Failed with exit code %s: the job log says why.\n\n' "$status"; fi
      if [ -s "$log" ]; then printf '```\n'; cat "$log"; printf '```\n'; fi
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  rm -f "$log"
}
trap summary EXIT

docker run --rm --platform "$platform" \
  -v "$sdk:/sdk:ro" -v "$plugin:/plugin:ro" -v "$(cd "$out" && pwd):/out" \
  -e SOURCE_DATE_EPOCH \
  -e GITHUB_REPOSITORY -e GITHUB_SHA -e GITHUB_REF -e GITHUB_RUN_ID -e GITHUB_RUN_ATTEMPT -e GITHUB_WORKFLOW_REF \
  "$IMAGE" bash -euo pipefail -c '
    bash /sdk/scripts/install-tools.sh
    mkdir /tmp/sdk && tar -C /sdk --exclude=node_modules --exclude=.git -cf - . | tar -C /tmp/sdk -xf -
    npm ci --prefix /tmp/sdk --omit=dev --no-audit --no-fund > /dev/null
    node /tmp/sdk/bin/volumio-plugin.js package /plugin "$@"' _ "${package_args[@]}" | tee "$log"
