#!/usr/bin/env bash
set -euo pipefail

# pre-push hook: verify that package.json and bun.lock are in sync on the commits
# being pushed. Runs a frozen install in a throwaway worktree, which is the same
# check CI performs. Only runs when package.json or bun.lock changed in the range.

zero="0000000000000000000000000000000000000000"
failed=0

while read -r local_ref local_obj remote_ref remote_obj; do
  case "$local_ref" in
    refs/heads/*) ;;
    *) continue ;;
  esac

  if [ -z "$remote_obj" ] || [ "$remote_obj" = "$zero" ]; then
    range="$local_obj^..$local_obj"
  else
    range="$remote_obj..$local_obj"
  fi

  changed="$(git diff --name-only "$range" 2>/dev/null || true)"
  if ! grep -qE '(^|/)package\.json$|^bun\.lock$' <<<"$changed"; then
    continue
  fi

  tmp="$(mktemp -d)"
  if ! git worktree add --detach --quiet "$tmp" "$local_obj" >/dev/null 2>&1; then
    rm -rf "$tmp"
    continue
  fi

  if ! (cd "$tmp" && bun install --frozen-lockfile >/dev/null 2>&1); then
    echo "ERROR: package.json and bun.lock are out of sync on $local_obj"
    echo "  fix: run 'bun install' and commit the updated bun.lock, then push again"
    failed=1
  fi
  git worktree remove --force "$tmp" >/dev/null 2>&1 || rm -rf "$tmp"
done

exit "$failed"
