#!/bin/sh
set -eu
# Run as root in WSL. Keep every fill file on a disposable 12 MiB mount.
exec unshare --mount --propagation private sh -ec '
  dir=$(mktemp -d)
  mount -t tmpfs -o size=12M tmpfs "$dir"
  trap '\''umount "$dir"; rmdir "$dir"'\'' EXIT
  export TMPDIR="$dir"
  "$1" scripts/check-job-storage.mjs --disk-full
  "$1" scripts/check-job-runtime-full.mjs
' sh "${1:-node}"
