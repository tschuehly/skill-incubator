#!/usr/bin/env bash
# Print the exact next Quality Loop action from the durable Run Record.
# This command is read-only. Its stdout is an instruction contract for the Driver.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
RUN_DIR="${1:-${QL_RUN_DIR:-}}"

if [ -z "$RUN_DIR" ]; then
  STATE=""
  for CANDIDATE in .scratch/quality-loop/*/state.json; do
    [ -f "$CANDIDATE" ] || continue
    if [ -z "$STATE" ] || [ "$CANDIDATE" -nt "$STATE" ]; then STATE="$CANDIDATE"; fi
  done
  if [ -n "$STATE" ]; then RUN_DIR="$(dirname "$STATE")"; fi
fi

emit() {
  local expected_scope="${5:-}"
  printf 'ACTION=%s\n' "$1"
  printf 'REFERENCE=%s\n' "$2"
  printf 'RUN_DIR=%s\n' "$RUN_DIR"
  printf 'NEXT=%s\n' "$3"
  if [ -n "${4:-}" ]; then printf 'CHAPTER=%s\n' "$4"; fi
  if [ -n "${SESSION_ID:-}" ]; then printf 'SESSION_ID=%s\n' "$SESSION_ID"; fi
  if [ -n "$expected_scope" ]; then
    printf 'EXPECTED_SCOPE=%s\n' "$expected_scope"
    if [ -z "${RUNTIME_SESSION_ID:-}" ] || [ -z "${SESSION_ID:-}" ] || \
      [ "$RUNTIME_SESSION_ID" != "$SESSION_ID" ]; then
      printf 'SESSION_BOUNDARY=bind-required\n'
    elif [ "${SCOPE:-}" != "$expected_scope" ]; then
      printf 'SESSION_BOUNDARY=fresh-required\n'
      printf 'RESUME=/quality-loop %s\n' "$RUN_DIR"
    else
      printf 'SESSION_BOUNDARY=continue\n'
    fi
  fi
}

if [ -z "$RUN_DIR" ] || [ ! -f "$RUN_DIR/state.json" ]; then
  RUN_DIR="${RUN_DIR:-.scratch/quality-loop/<run-slug>}"
  emit initialize "$SKILL_DIR/references/design.md" \
    "Read the reference. Create or adopt the GitHub Issue, initialize the Run Record, and build the Design Atelier." "" design
  exit 0
fi

STATE="$RUN_DIR/state.json"
RUNTIME_SESSION_ID="${QL_SESSION_ID:-}"
SESSION_ID="$(jq -r '.session.id // ""' "$STATE")"
SCOPE="$(jq -r '.session.scope // ""' "$STATE")"
PHASE="$(jq -r '.phase' "$STATE")"
MATERIAL="$(jq -r '[.deviations[]? | select(.status=="open" and (.impact=="high" or .impact=="critical"))] | length' "$STATE")"
OPEN_DECISIONS="$(jq -r '[.decisions[]? | select(.status=="open")] | length' "$STATE")"
OPEN_ADRS="$(jq -r '[.adrs[]? | select(.status=="provisional")] | length' "$STATE")"

if [ "$MATERIAL" -gt 0 ]; then
  emit design "$SKILL_DIR/references/design.md" \
    "Read the reference. Freeze implementation and return the material deviation to the Design Atelier." "" design
  exit 0
fi

if { [ "$PHASE" = "story" ] || [ "$PHASE" = "delivery" ]; } && [ "$OPEN_ADRS" -gt 0 ]; then
  emit ratification "$SKILL_DIR/references/modes.md" \
    "Read the reference. Stop delivery until the human ratifies or revises every provisional ADR."
  exit 0
fi

if { [ "$PHASE" = "story" ] || [ "$PHASE" = "delivery" ]; } && [ "$OPEN_DECISIONS" -gt 0 ]; then
  emit decision "$SKILL_DIR/references/modes.md" \
    "Read the reference. Stop delivery until the human answers every open Decision Inbox entry."
  exit 0
fi

case "$PHASE" in
  issue|design)
    emit design "$SKILL_DIR/references/design.md" \
      "Read the reference. Continue the Issue and Design Atelier workflow; do not implement before approval." "" design
    ;;
  chapters)
    ACTIVE="$(jq -r '
      . as $root | .timeline.proposed[] as $id |
      select($root.chapters[$id].status == "red" or $root.chapters[$id].status == "green" or
             $root.chapters[$id].status == "reviewed" or $root.chapters[$id].status == "pr-open") |
      select([ $root.decisions[]? | select(.status=="open" and (.affected | index($id))) ] | length == 0) |
      $id' "$STATE" | head -1)"
    if [ -n "$ACTIVE" ]; then
      STATUS="$(jq -r --arg id "$ACTIVE" '.chapters[$id].status' "$STATE")"
      emit chapter "$SKILL_DIR/references/chapter.md" \
        "Read the reference. Continue Chapter $ACTIVE from recorded status $STATUS and quote every mechanical gate." "$ACTIVE" "chapter:$ACTIVE"
      exit 0
    fi

    READY="$(jq -r '
      . as $root | .timeline.proposed[] as $id |
      select($root.chapters[$id].status == "planned") |
      select(all($root.chapters[$id].blocked_by[]; $root.chapters[.].status == "integrated")) |
      select([ $root.decisions[]? | select(.status=="open" and (.affected | index($id))) ] | length == 0) |
      $id' "$STATE" | head -1)"
    if [ -n "$READY" ]; then
      emit chapter "$SKILL_DIR/references/chapter.md" \
        "Read the reference. Implement, review, and integrate dependency-ready Chapter $READY." "$READY" "chapter:$READY"
    elif jq -e '(.chapters | length) > 0 and ([.chapters[].status] | all(. == "integrated"))' "$STATE" >/dev/null; then
      if [ "$OPEN_ADRS" -gt 0 ]; then
        emit ratification "$SKILL_DIR/references/modes.md" \
          "Read the reference. Stop before the System Story until the human ratifies or revises every provisional ADR."
      elif [ "$OPEN_DECISIONS" -gt 0 ]; then
        emit decision "$SKILL_DIR/references/modes.md" \
          "Read the reference. Stop before the System Story until the human answers every open Decision Inbox entry."
      else
        emit story "$SKILL_DIR/references/delivery.md" \
          "Read the reference. Begin the System Story and pause at its human understanding gate." "" story
      fi
    elif [ "$OPEN_DECISIONS" -gt 0 ]; then
      emit decision "$SKILL_DIR/references/modes.md" \
        "Read the reference. Keep affected Chapters blocked; continue only independent work or wait for the human."
    else
      emit blocked "$SKILL_DIR/references/chapter.md" \
        "Read the reference. The Ledger has no dependency-ready Chapter; inspect recorded blockers and do not bypass them."
    fi
    ;;
  story)
    emit story "$SKILL_DIR/references/delivery.md" \
      "Read the reference. Continue the System Story and wait for human acceptance of the exact Surface revision." "" story
    ;;
  delivery)
    emit delivery "$SKILL_DIR/references/delivery.md" \
      "Read the reference. Run final preflight, open or service the integration PR, and leave the merge to the human." "" delivery
    ;;
  done)
    emit done "$SKILL_DIR/references/delivery.md" \
      "Read the reference. Report the completed Run, accepted revisions, and final PR; perform no more delivery work."
    ;;
  *)
    echo "error: unknown Quality Loop phase '$PHASE'" >&2
    exit 2
    ;;
esac
