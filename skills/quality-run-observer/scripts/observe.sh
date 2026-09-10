#!/usr/bin/env bash
# observe.sh — content-addressed watcher for a Quality Run under observation.
#
# READ-ONLY on everything it watches. Writes only inside --out.
# Snapshots every changed artifact the moment it changes, so a later edit cannot erase the version
# that produced the behaviour. Each stdout-visible change is appended to <out>/feed.log; arm a
# Monitor on that file rather than polling.
#
#   observe.sh --run-dir <quality-run-dir> --repo <observed-repo> --session <uuid> --out <dir>
#              [--project-dir <~/.claude/projects/...>] [--interval <seconds>]
set -uo pipefail

RUN_DIR=""; REPO=""; SESSION=""; OUT=""; PROJECT_DIR=""; INTERVAL=25
while [ $# -gt 0 ]; do
  case "$1" in
    --run-dir) RUN_DIR="$2"; shift 2;;
    --repo) REPO="$2"; shift 2;;
    --session) SESSION="$2"; shift 2;;
    --out) OUT="$2"; shift 2;;
    --project-dir) PROJECT_DIR="$2"; shift 2;;
    --interval) INTERVAL="$2"; shift 2;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
[ -n "$RUN_DIR" ] && [ -n "$REPO" ] && [ -n "$OUT" ] || {
  echo "usage: observe.sh --run-dir <dir> --repo <dir> --session <uuid> --out <dir>" >&2; exit 2; }
[ -d "$RUN_DIR" ] || { echo "error: run dir $RUN_DIR does not exist" >&2; exit 2; }

# The harness persists every workflow script and subagent transcript under the session directory —
# evidence the observed run does not curate. Derive it from the repo path when not given.
if [ -z "$PROJECT_DIR" ] && [ -n "$SESSION" ]; then
  SLUG="$(printf '%s' "$REPO" | sed 's|/|-|g')"
  PROJECT_DIR="$HOME/.claude/projects/$SLUG/$SESSION"
fi

SNAP="$OUT/snapshots"; FEED="$OUT/feed.log"
mkdir -p "$SNAP/tracked"
note() { echo "[$(date '+%Y-%m-%dT%H:%M:%S')] $*" >> "$FEED"; }

digest() { if command -v md5 >/dev/null 2>&1; then md5 -q "$1"; else md5sum "$1" | awk '{print $1}'; fi; }

# snap <file> <label> — copy only when content changed since the last capture
snap() {
  local f="$1" label="$2"
  [ -f "$f" ] || return 0
  local h; h="$(digest "$f" 2>/dev/null)" || return 0
  local last="$SNAP/tracked/.$label.lasthash" prev=""
  [ -f "$last" ] && prev="$(cat "$last")"
  [ "$h" = "$prev" ] && return 0
  mkdir -p "$SNAP/tracked/$label"
  cp "$f" "$SNAP/tracked/$label/$(date '+%H%M%S')-$h.snap" 2>/dev/null
  echo "$h" > "$last"
  note "CHANGED $label -> $(date '+%H%M%S')-$h.snap ($(wc -c < "$f" | tr -d ' ') bytes)"
}

# snap_tree <root> <prefix> — snapshot every file under a tree, label-flattened
snap_tree() {
  local root="$1" prefix="$2"
  [ -d "$root" ] || return 0
  while IFS= read -r f; do
    snap "$f" "${prefix}__$(printf '%s' "$f" | sed "s|$root/||; s|/|__|g")"
  done < <(find "$root" -type f 2>/dev/null)
}

note "watcher start (run=$RUN_DIR repo=$REPO session=${SESSION:-none})"
while true; do
  snap "$RUN_DIR/state.json" state
  snap "$RUN_DIR/journal.md" journal
  snap "$RUN_DIR/workspace-leases.json" leases
  snap_tree "$RUN_DIR/evidence" evidence
  [ -n "$PROJECT_DIR" ] && snap_tree "$PROJECT_DIR/workflows" session-workflows

  {
    git -C "$REPO" log --oneline -1 2>/dev/null
    git -C "$REPO" branch --show-current 2>/dev/null
    git -C "$REPO" status --porcelain 2>/dev/null
    git -C "$REPO" worktree list 2>/dev/null
    git -C "$REPO" stash list 2>/dev/null
  } > "$SNAP/.git-now" 2>/dev/null
  snap "$SNAP/.git-now" git

  sleep "$INTERVAL"
done
