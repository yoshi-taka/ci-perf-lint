#!/usr/bin/env bash
set -euo pipefail

# pre-push hook: check that any v* tag being pushed matches package.json version

while read -r local_ref local_obj remote_ref remote_obj; do
  case "$local_ref" in
    refs/tags/v*)
      tag_ver="${local_ref#refs/tags/v}"
      pkg_ver="$(git show "$local_obj:package.json" 2>/dev/null | grep -o '"version": *"[^"]*"' | head -1 | cut -d'"' -f4)"
      if [ "$tag_ver" != "$pkg_ver" ]; then
        echo "ERROR: tag v$tag_ver but package.json version is $pkg_ver"
        echo "  tag commit: $local_obj"
        echo "  fix: update package.json version to $tag_ver on this commit, then retag"
        exit 1
      fi
      ;;
  esac
done
