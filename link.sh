#!/usr/bin/env bash
# Symlink an incubator skill into Claude, Codex, and Pi (global or project-local).
# Supported compositions install their required skills in the same operation.
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
  BASE="$(cd "$2" && pwd)"
  CLAUDE_SKILL_TARGET="$BASE/.claude/skills"
  CODEX_SKILL_TARGET="$BASE/.codex/skills"
  PI_SKILL_TARGET="$BASE/.agents/skills"
else
  CLAUDE_SKILL_TARGET="$HOME/.claude/skills"
  CODEX_SKILL_TARGET="$HOME/.codex/skills"
  PI_SKILL_TARGET="$HOME/.agents/skills"
fi
mkdir -p "$CLAUDE_SKILL_TARGET" "$CODEX_SKILL_TARGET" "$PI_SKILL_TARGET"

SKILLS=("$REQUESTED")

CLAUDE_AGENT_TARGET="$(dirname "$CLAUDE_SKILL_TARGET")/agents"
CODEX_AGENT_TARGET="$(dirname "$CODEX_SKILL_TARGET")/agents"
for SKILL in "${SKILLS[@]}"; do
  SRC="$(resolve_skill "$SKILL")" || exit 1
  # Runtimes address a skill by its bare name; an owner/ prefix is repo-only.
  NAME="$(basename "$SRC")"
  ln -sfn "$SRC" "$CLAUDE_SKILL_TARGET/$NAME"
  echo "linked $CLAUDE_SKILL_TARGET/$NAME -> $SRC"
  ln -sfn "$SRC" "$CODEX_SKILL_TARGET/$NAME"
  echo "linked $CODEX_SKILL_TARGET/$NAME -> $SRC"
  ln -sfn "$SRC" "$PI_SKILL_TARGET/$NAME"
  echo "linked $PI_SKILL_TARGET/$NAME -> $SRC"

  # Per-file agent links keep unrelated agents in each runtime untouched.
  if [ -d "$SRC/agents" ]; then
    mkdir -p "$CLAUDE_AGENT_TARGET" "$CODEX_AGENT_TARGET"
    for a in "$SRC"/agents/*.md; do
      [ -e "$a" ] || continue
      ln -sfn "$a" "$CLAUDE_AGENT_TARGET/$(basename "$a")"
      echo "linked $CLAUDE_AGENT_TARGET/$(basename "$a") -> $a"
    done
    for a in "$SRC"/agents/*.toml; do
      [ -e "$a" ] || continue
      ln -sfn "$a" "$CODEX_AGENT_TARGET/$(basename "$a")"
      echo "linked $CODEX_AGENT_TARGET/$(basename "$a") -> $a"
    done
  fi
done
