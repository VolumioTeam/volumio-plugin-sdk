#!/usr/bin/env bash
# Lists, as a JSON array, the plugin folders of a repository that holds one plugin per top-level
# folder (volumio-plugins-sources-bookworm): the folders that have a package.json and that changed
# between two commits, or every one with "all". Run it from the repository root, with the history
# of both commits fetched. Usage: scripts/changed-plugins.sh <base> <head> | scripts/changed-plugins.sh all
set -euo pipefail

if [ "${1:-}" = all ] && [ $# -eq 1 ]; then
  folders=$(git ls-tree -d --name-only HEAD)
elif [ $# -eq 2 ]; then
  # Changes at the root (README, .github) have no slash: -s drops them.
  folders=$(git diff --name-only "$1...$2" | cut -d/ -f1 -s | sort -u)
else
  echo "Usage: $0 <base> <head> | $0 all" >&2
  exit 2
fi

# A folder the change deleted has no package.json any more: nothing to build.
while IFS= read -r folder; do
  if [ -n "$folder" ] && [ -f "$folder/package.json" ]; then printf '%s\n' "$folder"; fi
done <<< "$folders" | jq -Rnc '[inputs]'
