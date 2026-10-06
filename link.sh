#!/usr/bin/env bash
# Symlink an incubator skill into Pi (global or project-local).
# The incubator stays the single source of truth — never copy, always link.
#
# Skills live in two trees: skills/ holds incubator-native skills, and
# vendored/<upstream-owner>/ holds skills forked from an external installer
# (see vendored/MANIFEST.json). A bare name resolves across both.
#
# Usage:
#   ./link.sh <skill-name>                  # link globally
#   ./link.sh <owner>/<skill-name>          # disambiguate a vendored skill
#   ./link.sh <skill-name> <project-dir>    # link into a project
#
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 <skill-name>|<owner>/<skill-name> [project-dir]" >&2; exit 1; }
REQUESTED="$1"
ROOT="$(cd "$(dirname "$0")" && pwd)"

# Print the directory for a skill name, or fail with every place it looked.
# An ambiguous bare name is an error, not a silent pick — the caller must say
# which one via <owner>/<name>.
resolve_skill() {
  local name="$1" c matches=()
  if [ -d "$ROOT/vendored/$name" ] && [ -f "$ROOT/vendored/$name/SKILL.md" ]; then
    printf '%s\n' "$ROOT/vendored/$name"   # explicit owner/name
    return 0
  fi
  for c in "$ROOT/skills/$name" "$ROOT"/vendored/*/"$name"; do
    [ -d "$c" ] && matches+=("$c")
  done
  case "${#matches[@]}" in
    0) echo "no such skill: $name (looked in $ROOT/skills and $ROOT/vendored/*)" >&2; return 1 ;;
    1) printf '%s\n' "${matches[0]}"; return 0 ;;
    *) { echo "ambiguous skill name: $name"; printf '  %s\n' "${matches[@]}"
         echo "pass <owner>/<name> to choose one"; } >&2; return 1 ;;
  esac
}

resolve_skill "$REQUESTED" >/dev/null
if [ $# -ge 2 ]; then
  PI_SKILL_TARGET="$(cd "$2" && pwd)/.agents/skills"
else
  PI_SKILL_TARGET="$HOME/.agents/skills"
fi
mkdir -p "$PI_SKILL_TARGET"

SRC="$(resolve_skill "$REQUESTED")"
# Pi addresses a skill by its bare name; an owner/ prefix is repo-only.
NAME="$(basename "$SRC")"
ln -sfn "$SRC" "$PI_SKILL_TARGET/$NAME"
echo "linked $PI_SKILL_TARGET/$NAME -> $SRC"
