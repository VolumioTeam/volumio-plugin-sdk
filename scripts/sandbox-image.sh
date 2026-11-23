#!/usr/bin/env bash
# Builds the G4 sandbox image: the root filesystem of a Volumio V4 release, imported into Docker.
# Usage: scripts/sandbox-image.sh [tag]
# Needs only Docker: download, checks and extraction run in a pinned Debian container.
# The work happens in a Docker volume: case-sensitive on macOS too (the rootfs has names that
# differ only by case), and nothing root-owned is left on the host. Peak use is about 13 GB.
# ponytail: digs the rootfs out of the release image, amd64 only. Upgrade path: volumio-os
# publishes volumio-sandbox:<version>-<arch> at each release and this becomes a docker pull.
set -euo pipefail

# The release the sandbox runs, pinned with its sha256: bump it on purpose, never by accident.
VOLUMIO_VERSION=4.245
VOLUMIO_URL=https://updates2.volumio.org/x86_amd64/volumio/4.245/Volumio-4.245-2026-11-06-x86_amd64.zip
VOLUMIO_SHA256=d9d101c738bdeeb60910c33949b7925e10b2458ccf283e819afef9ae841f8ff3
TOOLS_IMAGE=debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc

tag=${1:-volumio-sandbox:$VOLUMIO_VERSION-amd64}
work=$(docker volume create)
trap 'docker volume rm "$work" > /dev/null' EXIT

# The x86 image is GPT; partition 1 is the ext4 "images" partition holding volumio_current.sqsh.
docker run --rm --platform linux/amd64 -v "$work:/work" \
  -e VOLUMIO_URL="$VOLUMIO_URL" -e VOLUMIO_SHA256="$VOLUMIO_SHA256" -e VOLUMIO_VERSION="$VOLUMIO_VERSION" \
  "$TOOLS_IMAGE" bash -euo pipefail -c '
    apt-get update -qq && apt-get install -y -qq curl ca-certificates unzip 7zip squashfs-tools > /dev/null
    cd /work
    curl -fsSL -o image.zip "$VOLUMIO_URL"
    echo "$VOLUMIO_SHA256  image.zip" | sha256sum -c --quiet -
    unzip -q -p image.zip "*.img" > disk.img
    rm image.zip
    7zz e -y -bd -bso0 disk.img 1.primary.img
    rm disk.img
    7zz e -y -bd -bso0 1.primary.img volumio_current.sqsh
    rm 1.primary.img
    unsquashfs -q -n -d rootfs volumio_current.sqsh
    rm volumio_current.sqsh
    version=$(sed -n "s/^VOLUMIO_VERSION=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" rootfs/etc/os-release)
    [ "$version" = "$VOLUMIO_VERSION" ] || { echo "rootfs is $version, expected $VOLUMIO_VERSION" >&2; exit 1; }'

docker run --rm --platform linux/amd64 -v "$work:/work" "$TOOLS_IMAGE" \
  bash -euo pipefail -c 'tar -C /work/rootfs --numeric-owner -cf - .' |
  docker import --platform linux/amd64 \
    --change 'ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
    --change "LABEL org.volumio.version=$VOLUMIO_VERSION" \
    --change 'CMD ["/bin/bash"]' \
    - "$tag" > /dev/null

# Smoke check: the backend and its Node are where the plugin manager expects them.
docker run --rm --platform linux/amd64 "$tag" sh -c 'test -f /volumio/index.js && node --version' > /dev/null
echo "$tag"
