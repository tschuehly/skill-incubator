#!/usr/bin/env bash
# Face-off case setup: a copy of evals/lib/review-setup.sh with --no-renames, so a moved file keeps
# its deletion at the old path (the shared script lists only the new path of a rename).
#   "Base":   the tree with every src/main path that differs between BASE and PROPOSED taken from BASE
#   subject:  the proposed change (those paths back at PROPOSED)
# Env: SOURCE_REPO, BASE, PROPOSED, SUBJECT, optional SCOPE (pathspec, default src/main).
set -euo pipefail
: "${BASE:?}" "${PROPOSED:?}" "${SUBJECT:?}"
g() { git -c user.name=reviewer -c user.email=reviewer@local "$@"; }
paths=$(git -C "$SOURCE_REPO" diff --no-renames --name-only "$BASE" "$PROPOSED" -- "${SCOPE:-src/main}")
keep=$(mktemp -d)
for p in $paths; do [ -e "$p" ] && { mkdir -p "$keep/$(dirname "$p")"; cp -p "$p" "$keep/$p"; }; done
for p in $paths; do
  if git -C "$SOURCE_REPO" cat-file -e "$BASE:$p" 2>/dev/null; then mkdir -p "$(dirname "$p")"; git -C "$SOURCE_REPO" show "$BASE:$p" > "$p"; else rm -f "$p"; fi
done
git init -q && git add -A && g commit -qm "Base"
for p in $paths; do if [ -e "$keep/$p" ]; then mkdir -p "$(dirname "$p")"; cp -p "$keep/$p" "$p"; else rm -f "$p"; fi; done
rm -rf "$keep"
git add -A && g commit -qm "$SUBJECT"
