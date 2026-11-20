#!/usr/bin/env bash
# Installs the tools the gates run, in the build container (Debian Bookworm): zip and ShellCheck
# from Debian, gitleaks from its release, checked against the pinned sha256.
set -euo pipefail

GITLEAKS_VERSION=8.30.1

apt-get update -qq && apt-get install -y -qq zip shellcheck > /dev/null

case $(dpkg --print-architecture) in
  amd64) asset=linux_x64 sum=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  armhf) asset=linux_armv7 sum=8d39f0d94ba0d774b2282187656fb039a2d82893ec1fd6be7d7121aae759a57d ;;
  arm64) asset=linux_arm64 sum=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;;
  *) echo "No gitleaks build for $(dpkg --print-architecture)" >&2; exit 1 ;;
esac
tgz=$(mktemp)
curl -fsSL -o "$tgz" "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${asset}.tar.gz"
echo "$sum  $tgz" | sha256sum -c --quiet -
tar -xzf "$tgz" -C /usr/local/bin gitleaks
rm -f "$tgz"
