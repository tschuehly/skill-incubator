#!/usr/bin/env bash
# ledger.sh — sole writer of a Quality Run's state.json.
#
# Usage:
#   ledger.sh init <slug>
#   ledger.sh get [<jq-filter>]
#   ledger.sh issue <number> <url>
#   ledger.sh integration-branch <name>
#   ledger.sh design surface <url> <store>
#   ledger.sh design approve <revision>
#   ledger.sh design reopen <deviation-id>
#   ledger.sh add-chapter <id> <criticality> <impact> [<blocked-by-csv>]
#   ledger.sh chapter <id> status <state>
#   ledger.sh chapter <id> branch|base|pr <value>
#   ledger.sh chapter <id> links <concepts-csv> <architecture-csv>
#   ledger.sh chapter <id> plan <criticality> <impact> [<blocked-by-csv>]
#   ledger.sh chapter <id> resume <design-revision>
#   ledger.sh chapter <id> impact <higher-impact> <evidence>
#   ledger.sh timeline proposed <chapter-csv>
#   ledger.sh chapter <id> review-round|feedback-round
#   ledger.sh record <id> <key> <exit-code> [<note>]
#   ledger.sh deviation add <id> <impact> <summary>
#   ledger.sh deviation resolve <id> <design-revision>
#   ledger.sh mode get
#   ledger.sh mode set <supervised|afk> <actor>
#   ledger.sh session get
#   QL_SESSION_ID=<runtime-id> ledger.sh session bind <scope> <actor>
#   ledger.sh envelope approve <impact-ceiling> <max-adrs> <summary>
#   ledger.sh envelope get
#   ledger.sh decision add <id> <impact> <reversibility> <affected-csv> <summary>
#   ledger.sh decision answer <id> <answer>
#   ledger.sh decision list
#   ledger.sh adr add <id> <impact> <chapter> <summary>
#   ledger.sh adr ratify <id>
#   ledger.sh adr revise <id> <deviation-id>
#   ledger.sh notify <kind> <note>
#   ledger.sh story begin|surface|accept ...
#   ledger.sh collaborator bind|checkpoint ...
#   ledger.sh final-pr open|record|feedback-round|ready ...
#   ledger.sh finish
set -euo pipefail

: "${QL_RUN_DIR:?QL_RUN_DIR not set — export QL_RUN_DIR=.scratch/quality-loop/<run-slug>}"
STATE="$QL_RUN_DIR/state.json"
CMD="${1:?usage: ledger.sh <command> ...}"
shift

require_state() {
  [ -f "$STATE" ] || { echo "error: $STATE missing — run 'ledger.sh init <slug>' first" >&2; exit 2; }
}

write() {
  local program="$1"; shift
  local tmp
  tmp="$(mktemp "$QL_RUN_DIR/.state.XXXXXX")"
  jq "$@" "$program" "$STATE" > "$tmp" && mv "$tmp" "$STATE"
}

csv_json() {
  if [ -z "${1:-}" ]; then printf '[]'; else jq -cn --arg csv "$1" '$csv | split(",")'; fi
}

valid_criticality() {
  case "$1" in critical|standard|low) return 0;; *) return 1;; esac
}

valid_impact() {
  case "$1" in critical|high|elevated|contained|low) return 0;; *) return 1;; esac
}

require_session_scope() {
  local expected="$1"
  local runtime_session_id="${QL_SESSION_ID:-}"
  [ -n "$runtime_session_id" ] || {
    echo "error: QL_SESSION_ID is required for scoped actions" >&2
    exit 3
  }
  jq -e --arg expected "$expected" --arg runtime_session_id "$runtime_session_id" '
    .session.id == $runtime_session_id and .session.scope == $expected
  ' "$STATE" >/dev/null || {
    echo "error: this action requires a session bound to scope $expected" >&2
    exit 3
  }
}

require_gate_evidence() {
  local chapter="$1" key="$2" manifest_rel log_rel digest chapter_base
  manifest_rel="$(jq -r --arg id "$chapter" --arg key "$key" '.chapters[$id].evidence[$key].manifest // ""' "$STATE")"
  log_rel="$(jq -r --arg id "$chapter" --arg key "$key" '.chapters[$id].evidence[$key].log // ""' "$STATE")"
  digest="$(jq -r --arg id "$chapter" --arg key "$key" '.chapters[$id].evidence[$key].digest // ""' "$STATE")"
  chapter_base="$(jq -r --arg id "$chapter" '.chapters[$id].base // ""' "$STATE")"
  case "$manifest_rel:$log_rel" in
    evidence/*:evidence/*) ;;
    *) echo "error: invalid durable paths for '$key' evidence" >&2; exit 3;;
  esac
  case "$manifest_rel:$log_rel" in
    *../*) echo "error: invalid durable paths for '$key' evidence" >&2; exit 3;;
  esac
  [ -f "$QL_RUN_DIR/$manifest_rel" ] && [ -f "$QL_RUN_DIR/$log_rel" ] || {
    echo "error: missing durable files for '$key' evidence" >&2
    exit 3
  }
  [ "$(shasum -a 256 "$QL_RUN_DIR/$log_rel" | awk '{print $1}')" = "$digest" ] &&
    jq -e --arg key "$key" --arg log "$log_rel" --arg manifest "$manifest_rel" \
      --arg digest "$digest" --arg chapter_base "$chapter_base" '
        .kind=="test-gate" and .evidence_key==$key and .gate_exit==0 and .verdict=="PASS" and
        .log==$log and .manifest==$manifest and .digest==$digest and .chapter_base==$chapter_base
      ' "$QL_RUN_DIR/$manifest_rel" >/dev/null || {
        echo "error: '$key' evidence failed durable manifest verification" >&2
        exit 3
      }
}

validate_scope() {
  local scope="$1"
  case "$scope" in
    design|story|delivery) :;;
    chapter:*)
      local chapter_id="${scope#chapter:}"
      jq -e --arg id "$chapter_id" '.chapters[$id] != null' "$STATE" >/dev/null \
        || { echo "error: scope names unknown Chapter $chapter_id" >&2; exit 2; }
      ;;
    *) echo "error: scope must be design|chapter:<id>|story|delivery" >&2; exit 2;;
  esac
}

impact_rank() {
  case "$1" in low) echo 1;; contained) echo 2;; elevated) echo 3;; high) echo 4;; critical) echo 5;; *) echo 0;; esac
}

case "$CMD" in
  init)
    SLUG="${1:?init needs <slug>}"
    mkdir -p "$QL_RUN_DIR/chapters"
    [ -f "$STATE" ] && { echo "error: $STATE already exists — refusing to overwrite" >&2; exit 2; }
    jq -n --arg slug "$SLUG" '{
      run:$slug, phase:"issue", mode:"supervised", mode_events:[],
      session:{id:"",scope:"",actor:"",events:[]},
      issue:{number:null,url:""}, integration_branch:"",
      design:{surface_url:"",store:"",revision:"",approved:false,plan_digest:""},
      envelope:{approved:false,impact_ceiling:"",max_adrs:0,summary:"",design_revision:"",digest:""},
      story:{surface_url:"",store:"",revision:"",accepted:false},
      chapters:{}, timeline:{proposed:[],actual:[]},
      deviations:{}, decisions:{}, adrs:{}, notifications:[], collaborators:{},
      final_pr:{number:null,status:"none",feedback_rounds:0,evidence:{}}, blocked:[]
    }' > "$STATE"
    touch "$QL_RUN_DIR/journal.md"
    echo "initialized $STATE"
    ;;

  get)
    require_state
    jq -r "${1:-.}" "$STATE"
    ;;

  issue)
    require_state
    require_session_scope design
    NUMBER="${1:?issue needs <number>}"; URL="${2:?issue needs <url>}"
    [[ "$NUMBER" =~ ^[0-9]+$ ]] || { echo "error: issue number must be numeric" >&2; exit 2; }
    write '.issue={number:($number|tonumber),url:$url} | .phase="design"' \
      --arg number "$NUMBER" --arg url "$URL"
    echo "ok: issue #$NUMBER $URL"
    ;;

  integration-branch)
    require_state
    require_session_scope design
    BRANCH="${1:?integration-branch needs <name>}"
    write '.integration_branch=$branch' --arg branch "$BRANCH"
    echo "ok: integration branch=$BRANCH"
    ;;

  design)
    require_state
    ACTION="${1:?design needs surface|approve|reopen}"; shift
    case "$ACTION" in
      surface)
        URL="${1:?design surface needs <url>}"; STORE="${2:?design surface needs <store>}"
        require_session_scope design
        write '.design.surface_url=$url | .design.store=$store' --arg url "$URL" --arg store "$STORE"
        echo "ok: design surface=$URL store=$STORE"
        ;;
      approve)
        REVISION="${1:?design approve needs <revision>}"
        require_session_scope design
        jq -e '.phase=="design" and .issue.number!=null and .integration_branch!="" and
          .design.surface_url!="" and (.chapters|length)>0 and
          (. as $root | .timeline.proposed as $order |
            (($root.chapters|keys|sort)==($order|sort)) and
            all($root.chapters|to_entries[];
              .key as $id | all(.value.blocked_by[];
                . as $blocker | ($order|index($blocker)) as $bi | ($order|index($id)) as $ii |
                $bi!=null and $ii!=null and $bi<$ii)))' "$STATE" >/dev/null \
          || { echo "error: record Issue, integration branch, Design Surface, and proposed Chapters before approval" >&2; exit 3; }
        PLAN_DIGEST="$(jq -cS '{
          chapters:(.chapters|to_entries|map({id:.key,criticality:.value.criticality,
            impact:.value.impact,blocked_by:.value.blocked_by,concepts:.value.concepts,
            architecture:.value.architecture})),
          timeline:.timeline.proposed
        }' "$STATE" | git hash-object --stdin)"
        write '.design.approved=true | .design.revision=$revision | .design.plan_digest=$digest |
          .phase="chapters" |
          if .mode=="afk" and .envelope.design_revision!=$revision then
            .mode="supervised" |
            .mode_events += [{mode:"supervised",actor:"ledger",
              note:"envelope invalidated by new Design revision",at:(now|todate)}]
          else . end' --arg revision "$REVISION" --arg digest "$PLAN_DIGEST"
        echo "ok: design approved revision=$REVISION plan=$PLAN_DIGEST"
        ;;
      reopen)
        DEVIATION="${1:?design reopen needs <deviation-id>}"
        require_session_scope design
        jq -e --arg id "$DEVIATION" '.design.approved==true and .deviations[$id].status=="open" and
          (.deviations[$id].impact=="high" or .deviations[$id].impact=="critical")' "$STATE" >/dev/null \
          || { echo "error: Design may reopen only for an open material deviation" >&2; exit 3; }
        write '.design.approved=false | .story.accepted=false | .phase="design"'
        echo "ok: Design reopened for deviation=$DEVIATION"
        ;;
      *) echo "error: design action must be surface|approve|reopen" >&2; exit 2;;
    esac
    ;;

  add-chapter)
    require_state
    require_session_scope design
    ID="${1:?add-chapter needs <id>}"; CRITICALITY="${2:?add-chapter needs <criticality>}"
    IMPACT="${3:?add-chapter needs <impact>}"; BLOCKED_BY="${4:-}"
    valid_criticality "$CRITICALITY" || { echo "error: criticality must be critical|standard|low" >&2; exit 2; }
    valid_impact "$IMPACT" || { echo "error: impact must be critical|high|elevated|contained|low" >&2; exit 2; }
    jq -e '.phase=="design" and .design.approved==false' "$STATE" >/dev/null \
      || { echo "error: add or change proposed Chapters only while Design is open" >&2; exit 3; }
    jq -e --arg id "$ID" '.chapters[$id] == null' "$STATE" >/dev/null \
      || { echo "error: Chapter $ID already exists" >&2; exit 3; }
    BLOCKED_JSON="$(csv_json "$BLOCKED_BY")"
    write '.chapters[$id]={
        status:"planned",criticality:$criticality,impact:$impact,
        blocked_by:$blocked,concepts:[],architecture:[],branch:"",base:"",pr:null,blocked_from:null,
        impact_history:[{value:$impact,evidence:"Design approval",at:(now|todate)}],
        review_rounds:0,feedback_rounds:0,evidence:{},evidence_attempts:[]
      } | .timeline.proposed += [$id]' \
      --arg id "$ID" --arg criticality "$CRITICALITY" --arg impact "$IMPACT" \
      --argjson blocked "$BLOCKED_JSON"
    echo "ok: Chapter $ID criticality=$CRITICALITY impact=$IMPACT blocked_by=[$BLOCKED_BY]"
    ;;

  chapter)
    require_state
    ID="${1:?chapter needs <id>}"; FIELD="${2:?chapter needs a field}"; shift 2
    CURRENT="$(jq -r --arg id "$ID" '.chapters[$id].status // empty' "$STATE")"
    [ -n "$CURRENT" ] || { echo "error: unknown Chapter $ID" >&2; exit 2; }
    case "$FIELD" in links|plan) :;; *) require_session_scope "chapter:$ID";; esac
    case "$FIELD" in
      status)
        VALUE="${1:?chapter status needs <state>}"
        if [ "$VALUE" = "blocked" ]; then
          :
        elif jq -e '[.deviations[]?|select(.status=="open" and (.impact=="high" or .impact=="critical"))]|length>0' "$STATE" >/dev/null; then
          echo "error: Run has an open material deviation" >&2; exit 3
        elif jq -e --arg id "$ID" '[.decisions[]?|select(.status=="open" and (.affected|index($id)))]|length>0' "$STATE" >/dev/null; then
          echo "error: Chapter $ID is affected by an open decision — answer it first" >&2; exit 3
        elif [ "$CURRENT" = "blocked" ]; then
          echo "error: Chapter $ID is blocked — only an explicit recorded decision may resume it" >&2; exit 3
        elif [ "$CURRENT" = "planned" ] && [ "$VALUE" = "red" ]; then
          require_session_scope "chapter:$ID"
          jq -e --arg id "$ID" '. as $root | all($root.chapters[$id].blocked_by[]; $root.chapters[.].status=="integrated")' "$STATE" >/dev/null \
            || { echo "error: Chapter $ID has an unintegrated blocker" >&2; exit 3; }
        elif [ "$CURRENT" = "red" ] && [ "$VALUE" = "green" ]; then
          for key in red green; do
            require_gate_evidence "$ID" "$key"
          done
          while IFS= read -r baseline_key; do
            [ -n "$baseline_key" ] || continue
            require_gate_evidence "$ID" "$baseline_key"
            comparison_key="compare:${baseline_key#baseline:}"
            require_gate_evidence "$ID" "$comparison_key"
          done < <(jq -r --arg id "$ID" '.chapters[$id].evidence | keys[] | select(startswith("baseline:"))' "$STATE")
        elif [ "$CURRENT" = "green" ] && [ "$VALUE" = "reviewed" ]; then
          jq -e --arg id "$ID" '.chapters[$id].review_rounds > 0' "$STATE" >/dev/null \
            || { echo "error: cannot mark reviewed — no review round recorded" >&2; exit 3; }
        elif [ "$CURRENT" = "reviewed" ] && { [ "$VALUE" = "integrated" ] || [ "$VALUE" = "pr-open" ]; }; then
          :
        elif [ "$CURRENT" = "pr-open" ] && [ "$VALUE" = "integrated" ]; then
          :
        else
          echo "error: illegal Chapter transition $CURRENT -> $VALUE" >&2; exit 3
        fi
        if [ "$VALUE" = "blocked" ]; then
          write '.chapters[$id].blocked_from=.chapters[$id].status | .chapters[$id].status="blocked" |
            .blocked = ((.blocked + [$id]) | unique)' --arg id "$ID"
        elif [ "$VALUE" = "integrated" ]; then
          write '.chapters[$id].status=$value |
            .timeline.actual += [{chapter:$id,at:(now|todate),pr:.chapters[$id].pr}]' \
            --arg id "$ID" --arg value "$VALUE"
        else
          write '.chapters[$id].status=$value' --arg id "$ID" --arg value "$VALUE"
        fi
        echo "ok: Chapter $ID $CURRENT -> $VALUE"
        ;;
      branch|base)
        VALUE="${1:?chapter $FIELD needs <value>}"
        require_session_scope "chapter:$ID"
        write ".chapters[\$id].$FIELD=\$value" --arg id "$ID" --arg value "$VALUE"
        echo "ok: Chapter $ID $FIELD=$VALUE"
        ;;
      pr)
        VALUE="${1:?chapter pr needs <number>}"
        [[ "$VALUE" =~ ^[0-9]+$ ]] || { echo "error: PR number must be numeric" >&2; exit 2; }
        write '.chapters[$id].pr=($value|tonumber)' --arg id "$ID" --arg value "$VALUE"
        echo "ok: Chapter $ID pr=#$VALUE"
        ;;
      links)
        CONCEPTS="${1:-}"; ARCHITECTURE="${2:-}"
        require_session_scope design
        CONCEPTS_JSON="$(csv_json "$CONCEPTS")"; ARCHITECTURE_JSON="$(csv_json "$ARCHITECTURE")"
        write '.chapters[$id].concepts=$concepts | .chapters[$id].architecture=$architecture' \
          --arg id "$ID" --argjson concepts "$CONCEPTS_JSON" --argjson architecture "$ARCHITECTURE_JSON"
        echo "ok: Chapter $ID links concepts=[$CONCEPTS] architecture=[$ARCHITECTURE]"
        ;;
      plan)
        CRITICALITY="${1:?chapter plan needs <criticality>}"; VALUE="${2:?chapter plan needs <impact>}"
        require_session_scope design
        BLOCKED_BY="${3:-}"
        valid_criticality "$CRITICALITY" || { echo "error: invalid criticality $CRITICALITY" >&2; exit 2; }
        valid_impact "$VALUE" || { echo "error: invalid impact $VALUE" >&2; exit 2; }
        jq -e '.phase=="design" and .design.approved==false' "$STATE" >/dev/null \
          || { echo "error: Chapter plan changes require an open Design" >&2; exit 3; }
        BLOCKED_JSON="$(csv_json "$BLOCKED_BY")"
        write '.chapters[$id].criticality=$criticality | .chapters[$id].impact=$impact |
          .chapters[$id].blocked_by=$blocked |
          .chapters[$id].impact_history=[{value:$impact,evidence:"Design approval",at:(now|todate)}]' \
          --arg id "$ID" --arg criticality "$CRITICALITY" --arg impact "$VALUE" --argjson blocked "$BLOCKED_JSON"
        echo "ok: Chapter $ID plan criticality=$CRITICALITY impact=$VALUE blocked_by=[$BLOCKED_BY]"
        ;;
      resume)
        REVISION="${1:?chapter resume needs <design-revision>}"
        require_session_scope "chapter:$ID"
        [ "$CURRENT" = "blocked" ] || { echo "error: Chapter $ID is not blocked" >&2; exit 3; }
        jq -e --arg id "$ID" --arg revision "$REVISION" '
          .design.revision==$revision and .chapters[$id].blocked_from!=null and
          ([.deviations[]?|select(.status=="open" and (.impact=="high" or .impact=="critical"))]|length)==0
        ' "$STATE" >/dev/null || { echo "error: resolve the material deviation in the recorded Design revision first" >&2; exit 3; }
        write '.chapters[$id].status=.chapters[$id].blocked_from | .chapters[$id].blocked_from=null |
          .blocked=[.blocked[]|select(.!=$id)]' --arg id "$ID"
        VALUE="$(jq -r --arg id "$ID" '.chapters[$id].status' "$STATE")"
        echo "ok: Chapter $ID resumed at $VALUE with design revision=$REVISION"
        ;;
      impact)
        VALUE="${1:?chapter impact needs <higher-impact>}"; EVIDENCE="${2:?chapter impact needs <evidence>}"
        valid_impact "$VALUE" || { echo "error: invalid impact $VALUE" >&2; exit 2; }
        jq -e '.design.approved==true' "$STATE" >/dev/null \
          || { echo "error: use Chapter plan while Design is open" >&2; exit 3; }
        CURRENT_IMPACT="$(jq -r --arg id "$ID" '.chapters[$id].impact' "$STATE")"
        [ "$(impact_rank "$VALUE")" -gt "$(impact_rank "$CURRENT_IMPACT")" ] \
          || { echo "error: impact may only increase ($CURRENT_IMPACT -> $VALUE refused)" >&2; exit 3; }
        write '.chapters[$id].impact=$value |
          .chapters[$id].impact_history += [{value:$value,evidence:$evidence,at:(now|todate)}]' \
          --arg id "$ID" --arg value "$VALUE" --arg evidence "$EVIDENCE"
        echo "ok: Chapter $ID impact $CURRENT_IMPACT -> $VALUE"
        ;;
      review-round)
        ROUNDS="$(jq -r --arg id "$ID" '.chapters[$id].review_rounds' "$STATE")"
        if [ "$ROUNDS" -ge 3 ]; then
          echo "error: Chapter $ID reached the review-round cap (3) — record a high 'review non-convergence' deviation carrying every unresolved finding" >&2
          exit 3
        fi
        write '.chapters[$id].review_rounds += 1' --arg id "$ID"
        VALUE="$(jq -r --arg id "$ID" '.chapters[$id].review_rounds' "$STATE")"
        echo "ok: Chapter $ID review-round=$VALUE"
        ;;
      feedback-round)
        write '.chapters[$id].feedback_rounds += 1' --arg id "$ID"
        VALUE="$(jq -r --arg id "$ID" '.chapters[$id].feedback_rounds' "$STATE")"
        echo "ok: Chapter $ID feedback-round=$VALUE"
        ;;
      *) echo "error: unknown Chapter field '$FIELD'" >&2; exit 2;;
    esac
    ;;

  timeline)
    require_state
    require_session_scope design
    ACTION="${1:?timeline needs proposed}"; ORDER="${2:?timeline proposed needs <chapter-csv>}"
    [ "$ACTION" = "proposed" ] || { echo "error: timeline action must be proposed" >&2; exit 2; }
    jq -e '.phase=="design" and .design.approved==false' "$STATE" >/dev/null \
      || { echo "error: proposed timeline changes require an open Design" >&2; exit 3; }
    ORDER_JSON="$(csv_json "$ORDER")"
    jq -e --argjson order "$ORDER_JSON" '($order|sort)==(.chapters|keys|sort)' "$STATE" >/dev/null \
      || { echo "error: proposed timeline must contain every Chapter exactly once" >&2; exit 3; }
    write '.timeline.proposed=$order' --argjson order "$ORDER_JSON"
    echo "ok: proposed timeline=[$ORDER]"
    ;;

  record)
    require_state
    ID="${1:?record needs <chapter>}"; KEY="${2:?record needs <key>}"
    CODE="${3:?record needs <exit-code>}"; NOTE="${4:-}"; ARTIFACT="${5:-}"
    [[ "$CODE" =~ ^-?[0-9]+$ ]] || { echo "error: exit code must be numeric" >&2; exit 2; }
    jq -e --arg id "$ID" '.chapters[$id] != null' "$STATE" >/dev/null \
      || { echo "error: unknown Chapter $ID" >&2; exit 2; }
    require_session_scope "chapter:$ID"
    case "$KEY" in
      red|green|baseline:*|compare:*)
        [ -n "$ARTIFACT" ] || {
          echo "error: reserved gate evidence '$KEY' requires a test-gate manifest" >&2
          exit 2
        }
        ;;
    esac
    if [ -n "$ARTIFACT" ]; then
      [ -f "$ARTIFACT" ] || { echo "error: evidence artifact $ARTIFACT does not exist" >&2; exit 2; }
      jq -e 'type == "object"' "$ARTIFACT" >/dev/null \
        || { echo "error: evidence artifact must contain one JSON object" >&2; exit 2; }
      case "$KEY" in
        red|green|baseline:*|compare:*)
          MANIFEST_REL="$(jq -r '.manifest // ""' "$ARTIFACT")"
          LOG_REL="$(jq -r '.log // ""' "$ARTIFACT")"
          DIGEST="$(jq -r '.digest // ""' "$ARTIFACT")"
          case "$MANIFEST_REL:$LOG_REL" in
            evidence/*:evidence/*) ;;
            *) echo "error: gate manifest paths must stay under the Run evidence directory" >&2; exit 2;;
          esac
          case "$MANIFEST_REL:$LOG_REL" in
            *../*) echo "error: gate manifest paths must stay under the Run evidence directory" >&2; exit 2;;
          esac
          [ -f "$QL_RUN_DIR/$MANIFEST_REL" ] && [ -f "$QL_RUN_DIR/$LOG_REL" ] && \
            [ "$(shasum -a 256 "$QL_RUN_DIR/$LOG_REL" | awk '{print $1}')" = "$DIGEST" ] && \
            jq -e --arg key "$KEY" --argjson code "$CODE" --arg digest "$DIGEST" \
              --arg manifest "$MANIFEST_REL" --arg log "$LOG_REL" '
                .kind=="test-gate" and .evidence_key==$key and .gate_exit==$code and
                .verdict==(if $code==0 then "PASS" else "FAIL" end) and
                .digest==$digest and .manifest==$manifest and .log==$log
              ' "$ARTIFACT" >/dev/null || {
                echo "error: reserved gate evidence '$KEY' failed manifest or log verification" >&2
                exit 3
              }
          ;;
      esac
      write '($artifact[0] + {exit:($code|tonumber),note:$note,at:(now|todate)}) as $entry |
          .chapters[$id].evidence[$key]=$entry |
          .chapters[$id].evidence_attempts=((.chapters[$id].evidence_attempts // []) +
            [$entry + {key:$key}])' \
        --slurpfile artifact "$ARTIFACT" --arg id "$ID" --arg key "$KEY" \
        --arg code "$CODE" --arg note "$NOTE"
    else
      write '({exit:($code|tonumber),note:$note,at:(now|todate)}) as $entry |
          .chapters[$id].evidence[$key]=$entry |
          .chapters[$id].evidence_attempts=((.chapters[$id].evidence_attempts // []) +
            [$entry + {key:$key}])' \
        --arg id "$ID" --arg key "$KEY" --arg code "$CODE" --arg note "$NOTE"
    fi
    echo "ok: Chapter $ID evidence[$KEY] exit=$CODE"
    ;;

  deviation)
    require_state
    ACTION="${1:?deviation needs add|resolve}"; ID="${2:?deviation needs <id>}"; shift 2
    case "$ACTION" in
      add)
        IMPACT="${1:?deviation add needs <impact>}"; SUMMARY="${2:?deviation add needs <summary>}"
        valid_impact "$IMPACT" || { echo "error: invalid impact $IMPACT" >&2; exit 2; }
        write '.deviations[$id]={impact:$impact,summary:$summary,status:"open",design_revision:"",at:(now|todate)}' \
          --arg id "$ID" --arg impact "$IMPACT" --arg summary "$SUMMARY"
        if [ "$IMPACT" = "high" ] || [ "$IMPACT" = "critical" ]; then
          write '.blocked = ((.blocked + ["deviation:"+$id]) | unique)' --arg id "$ID"
        fi
        echo "ok: deviation $ID impact=$IMPACT open"
        ;;
      resolve)
        REVISION="${1:?deviation resolve needs <design-revision>}"
        jq -e --arg id "$ID" --arg revision "$REVISION" '.deviations[$id].status=="open" and
          .design.approved==true and .design.revision==$revision' "$STATE" >/dev/null \
          || { echo "error: deviation resolution requires the newly approved Design revision" >&2; exit 3; }
        write '.deviations[$id].status="resolved" | .deviations[$id].design_revision=$revision |
          .blocked = [.blocked[] | select(. != ("deviation:"+$id))]' --arg id "$ID" --arg revision "$REVISION"
        echo "ok: deviation $ID resolved in design revision=$REVISION"
        ;;
      *) echo "error: deviation action must be add|resolve" >&2; exit 2;;
    esac
    ;;

  mode)
    require_state
    ACTION="${1:?mode needs get|set}"; shift || true
    case "$ACTION" in
      get)
        jq -r '.mode' "$STATE"
        ;;
      set)
        VALUE="${1:?mode set needs <supervised|afk>}"; ACTOR="${2:?mode set needs <actor> (the human commanding the switch)}"
        case "$VALUE" in supervised|afk) :;; *) echo "error: mode must be supervised|afk" >&2; exit 2;; esac
        if [ "$VALUE" = "afk" ]; then
          jq -e '.envelope.approved==true and .envelope.design_revision==.design.revision' "$STATE" >/dev/null \
            || { echo "error: AFK requires an approved decision envelope for the current Design revision" >&2; exit 3; }
        fi
        write '.mode=$value | .mode_events += [{mode:$value,actor:$actor,at:(now|todate)}]' \
          --arg value "$VALUE" --arg actor "$ACTOR"
        echo "ok: mode=$VALUE by $ACTOR"
        ;;
      *) echo "error: mode action must be get|set" >&2; exit 2;;
    esac
    ;;

  session)
    require_state
    ACTION="${1:?session needs get|bind}"; shift || true
    case "$ACTION" in
      get)
        jq -r '.session // {id:"",scope:"",mode:"",actor:"",events:[]}' "$STATE"
        ;;
      bind)
        SESSION_ID="${QL_SESSION_ID:?session bind requires the runtime-provided QL_SESSION_ID}"
        SCOPE="${1:?session bind needs <scope>}"
        ACTOR="${2:?session bind needs <actor>}"
        validate_scope "$SCOPE"
        CURRENT_SESSION="$(jq -r '.session.id // ""' "$STATE")"
        CURRENT_SCOPE="$(jq -r '.session.scope // ""' "$STATE")"
        if [ "$CURRENT_SESSION" != "$SESSION_ID" ] && jq -e --arg session "$SESSION_ID" \
          '[.session.events[]? | select(.id==$session)] | length > 0' "$STATE" >/dev/null; then
          echo "error: session $SESSION_ID was already used — session ids cannot be rebound" >&2
          exit 3
        fi
        if [ "$CURRENT_SESSION" = "$SESSION_ID" ] && [ "$CURRENT_SCOPE" != "$SCOPE" ]; then
          echo "error: session $SESSION_ID is already bound to $CURRENT_SCOPE — use a fresh session to change scope" >&2
          exit 3
        fi
        if [ "$CURRENT_SESSION" = "$SESSION_ID" ] && [ "$CURRENT_SCOPE" = "$SCOPE" ]; then
          echo "ok: session unchanged id=$SESSION_ID scope=$SCOPE"
          exit 0
        fi
        write '.session = ((.session // {events:[]}) |
          .id=$session | .scope=$scope | .actor=$actor |
          .events=((.events // []) + [{id:$session,scope:$scope,actor:$actor,
            phase:$phase,at:(now|todate)}]))' \
          --arg session "$SESSION_ID" --arg scope "$SCOPE" --arg actor "$ACTOR" \
          --arg phase "$(jq -r .phase "$STATE")"
        echo "ok: session id=$SESSION_ID scope=$SCOPE by $ACTOR"
        ;;
      *) echo "error: session action must be get|bind" >&2; exit 2;;
    esac
    ;;

  envelope)
    require_state
    ACTION="${1:?envelope needs approve|get}"; shift || true
    case "$ACTION" in
      approve)
        CEILING="${1:?envelope approve needs <impact-ceiling>}"; MAX_ADRS="${2:?envelope approve needs <max-adrs>}"
        SUMMARY="${3:?envelope approve needs <summary> (invariants, scope, reversibility, stop conditions)}"
        valid_impact "$CEILING" || { echo "error: invalid impact ceiling $CEILING" >&2; exit 2; }
        [[ "$MAX_ADRS" =~ ^[0-9]+$ ]] || { echo "error: max-adrs must be numeric" >&2; exit 2; }
        jq -e '.design.approved==true' "$STATE" >/dev/null \
          || { echo "error: the envelope is approved at or after Design approval" >&2; exit 3; }
        DIGEST="$(jq -cS --arg c "$CEILING" --arg m "$MAX_ADRS" --arg s "$SUMMARY" \
          '{ceiling:$c,max_adrs:$m,summary:$s,design:.design.revision,plan:.design.plan_digest}' "$STATE" \
          | git hash-object --stdin)"
        write '.envelope={approved:true,impact_ceiling:$ceiling,max_adrs:($max|tonumber),
            summary:$summary,design_revision:.design.revision,digest:$digest}' \
          --arg ceiling "$CEILING" --arg max "$MAX_ADRS" --arg summary "$SUMMARY" --arg digest "$DIGEST"
        echo "ok: envelope approved ceiling=$CEILING max_adrs=$MAX_ADRS digest=$DIGEST"
        ;;
      get)
        jq -r '.envelope' "$STATE"
        ;;
      *) echo "error: envelope action must be approve|get" >&2; exit 2;;
    esac
    ;;

  decision)
    require_state
    ACTION="${1:?decision needs add|answer|list}"; shift || true
    case "$ACTION" in
      add)
        ID="${1:?decision add needs <id>}"; IMPACT="${2:?decision add needs <impact>}"
        REVERSIBILITY="${3:?decision add needs <reversibility>}"; AFFECTED="${4:?decision add needs <affected-csv>}"
        SUMMARY="${5:?decision add needs <summary> (tension, alternatives, recommendation)}"
        valid_impact "$IMPACT" || { echo "error: invalid impact $IMPACT" >&2; exit 2; }
        case "$IMPACT" in high|critical)
          echo "error: high/critical decisions are material deviations — use 'deviation add'" >&2; exit 2;;
        esac
        jq -e --arg id "$ID" '.decisions[$id]==null' "$STATE" >/dev/null \
          || { echo "error: decision $ID already exists" >&2; exit 3; }
        AFFECTED_JSON="$(csv_json "$AFFECTED")"
        jq -e --argjson affected "$AFFECTED_JSON" '. as $root | all($affected[]; $root.chapters[.]!=null)' "$STATE" >/dev/null \
          || { echo "error: every affected Chapter must exist" >&2; exit 2; }
        write '.decisions[$id]={impact:$impact,reversibility:$reversibility,affected:$affected,
            summary:$summary,status:"open",answer:"",at:(now|todate)}' \
          --arg id "$ID" --arg impact "$IMPACT" --arg reversibility "$REVERSIBILITY" \
          --argjson affected "$AFFECTED_JSON" --arg summary "$SUMMARY"
        echo "ok: decision $ID open impact=$IMPACT affected=[$AFFECTED]"
        ;;
      answer)
        ID="${1:?decision answer needs <id>}"; ANSWER="${2:?decision answer needs <answer>}"
        jq -e --arg id "$ID" '.decisions[$id].status=="open"' "$STATE" >/dev/null \
          || { echo "error: decision $ID is not open" >&2; exit 3; }
        write '.decisions[$id].status="answered" | .decisions[$id].answer=$answer |
          .decisions[$id].answered_at=(now|todate)' --arg id "$ID" --arg answer "$ANSWER"
        echo "ok: decision $ID answered"
        ;;
      list)
        jq -r '[.decisions|to_entries[]|select(.value.status=="open")|{id:.key}+.value]' "$STATE"
        ;;
      *) echo "error: decision action must be add|answer|list" >&2; exit 2;;
    esac
    ;;

  adr)
    require_state
    ACTION="${1:?adr needs add|ratify|revise}"; shift || true
    case "$ACTION" in
      add)
        ID="${1:?adr add needs <id>}"; IMPACT="${2:?adr add needs <impact>}"
        CHAPTER="${3:?adr add needs <chapter>}"; SUMMARY="${4:?adr add needs <summary>}"
        valid_impact "$IMPACT" || { echo "error: invalid impact $IMPACT" >&2; exit 2; }
        jq -e '.mode=="afk" and .envelope.approved==true and .envelope.design_revision==.design.revision' "$STATE" >/dev/null \
          || { echo "error: provisional ADRs require AFK mode with a valid envelope" >&2; exit 3; }
        jq -e --arg id "$ID" '.adrs[$id]==null' "$STATE" >/dev/null \
          || { echo "error: ADR $ID already exists" >&2; exit 3; }
        jq -e --arg ch "$CHAPTER" '.chapters[$ch]!=null' "$STATE" >/dev/null \
          || { echo "error: unknown Chapter $CHAPTER" >&2; exit 2; }
        CEILING="$(jq -r '.envelope.impact_ceiling' "$STATE")"
        [ "$(impact_rank "$IMPACT")" -le "$(impact_rank "$CEILING")" ] \
          || { echo "error: ADR impact $IMPACT exceeds the envelope ceiling $CEILING — block the Chapter instead" >&2; exit 3; }
        PROVISIONAL="$(jq -r '[.adrs[]?|select(.status=="provisional")]|length' "$STATE")"
        MAX="$(jq -r '.envelope.max_adrs' "$STATE")"
        [ "$PROVISIONAL" -lt "$MAX" ] \
          || { echo "error: envelope ADR budget ($MAX) exhausted — block the Chapter instead" >&2; exit 3; }
        write '.adrs[$id]={impact:$impact,chapter:$chapter,summary:$summary,status:"provisional",at:(now|todate)}' \
          --arg id "$ID" --arg impact "$IMPACT" --arg chapter "$CHAPTER" --arg summary "$SUMMARY"
        echo "ok: provisional ADR $ID impact=$IMPACT chapter=$CHAPTER"
        ;;
      ratify)
        ID="${1:?adr ratify needs <id>}"
        jq -e --arg id "$ID" '.adrs[$id].status=="provisional"' "$STATE" >/dev/null \
          || { echo "error: ADR $ID is not provisional" >&2; exit 3; }
        write '.adrs[$id].status="ratified" | .adrs[$id].ratified_at=(now|todate)' --arg id "$ID"
        echo "ok: ADR $ID ratified"
        ;;
      revise)
        ID="${1:?adr revise needs <id>}"; DEVIATION="${2:?adr revise needs <deviation-id>}"
        jq -e --arg id "$ID" '.adrs[$id].status=="provisional"' "$STATE" >/dev/null \
          || { echo "error: ADR $ID is not provisional" >&2; exit 3; }
        jq -e --arg dev "$DEVIATION" '.deviations[$dev].status=="open"' "$STATE" >/dev/null \
          || { echo "error: record the open deviation ($DEVIATION) before revising ADR $ID" >&2; exit 3; }
        write '.adrs[$id].status="revised" | .adrs[$id].deviation=$deviation' \
          --arg id "$ID" --arg deviation "$DEVIATION"
        echo "ok: ADR $ID revised via deviation $DEVIATION"
        ;;
      *) echo "error: adr action must be add|ratify|revise" >&2; exit 2;;
    esac
    ;;

  notify)
    require_state
    KIND="${1:?notify needs <kind>}"; NOTE="${2:?notify needs <note>}"
    write '.notifications += [{kind:$kind,note:$note,at:(now|todate)}]' --arg kind "$KIND" --arg note "$NOTE"
    echo "ok: notification recorded kind=$KIND"
    ;;

  story)
    require_state
    ACTION="${1:?story needs begin|surface|accept}"; shift
    case "$ACTION" in
      begin)
        require_session_scope story
        jq -e '(.chapters|length)>0 and ([.chapters[].status]|all(.=="integrated")) and
          ([.deviations[]?|select(.status=="open")]|length)==0' "$STATE" >/dev/null \
          || { echo "error: all Chapters must be integrated and deviations resolved before Story" >&2; exit 3; }
        jq -e '([.decisions[]?|select(.status=="open")]|length)==0' "$STATE" >/dev/null \
          || { echo "error: answer every open decision before Story" >&2; exit 3; }
        jq -e '([.adrs[]?|select(.status=="provisional")]|length)==0' "$STATE" >/dev/null \
          || { echo "error: ratify or revise every provisional ADR before Story" >&2; exit 3; }
        write '.phase="story"'
        echo "ok: System Story phase begun"
        ;;
      surface)
        URL="${1:?story surface needs <url>}"; STORE="${2:?story surface needs <store>}"
        require_session_scope story
        write '.story.surface_url=$url | .story.store=$store' --arg url "$URL" --arg store "$STORE"
        echo "ok: story surface=$URL store=$STORE"
        ;;
      accept)
        REVISION="${1:?story accept needs <revision>}"
        require_session_scope story
        jq -e '.phase=="story" and .story.surface_url!=""' "$STATE" >/dev/null \
          || { echo "error: begin Story and record its Surface before acceptance" >&2; exit 3; }
        write '.story.accepted=true | .story.revision=$revision | .phase="delivery"' --arg revision "$REVISION"
        echo "ok: System Story accepted revision=$REVISION"
        ;;
      *) echo "error: story action must be begin|surface|accept" >&2; exit 2;;
    esac
    ;;

  collaborator)
    require_state
    ACTION="${1:?collaborator needs bind|checkpoint}"; ROLE="${2:?collaborator needs <role>}"; shift 2
    case "$ACTION" in
      bind)
        AGENT_ID="${1:?collaborator bind needs <agent-id>}"; CHECKPOINT="${2:?collaborator bind needs <checkpoint>}"
        write '.collaborators[$role]={agent_id:$agent,checkpoint:$checkpoint,updated_at:(now|todate)}' \
          --arg role "$ROLE" --arg agent "$AGENT_ID" --arg checkpoint "$CHECKPOINT"
        echo "ok: collaborator $ROLE bound id=$AGENT_ID checkpoint=$CHECKPOINT"
        ;;
      checkpoint)
        CHECKPOINT="${1:?collaborator checkpoint needs <checkpoint>}"
        jq -e --arg role "$ROLE" '.collaborators[$role]!=null' "$STATE" >/dev/null \
          || { echo "error: collaborator $ROLE is not bound" >&2; exit 3; }
        write '.collaborators[$role].checkpoint=$checkpoint | .collaborators[$role].updated_at=(now|todate)' \
          --arg role "$ROLE" --arg checkpoint "$CHECKPOINT"
        echo "ok: collaborator $ROLE checkpoint=$CHECKPOINT"
        ;;
      *) echo "error: collaborator action must be bind|checkpoint" >&2; exit 2;;
    esac
    ;;

  final-pr)
    require_state
    ACTION="${1:?final-pr needs open|record|feedback-round|ready}"; shift
    case "$ACTION" in
      open)
        NUMBER="${1:?final-pr open needs <number>}"
        require_session_scope delivery
        [[ "$NUMBER" =~ ^[0-9]+$ ]] || { echo "error: PR number must be numeric" >&2; exit 2; }
        jq -e '.phase=="delivery" and .story.accepted==true and .final_pr.status=="none"' "$STATE" >/dev/null \
          || { echo "error: accepted Story and unopened final PR required" >&2; exit 3; }
        write '.final_pr.number=($number|tonumber) | .final_pr.status="open"' --arg number "$NUMBER"
        echo "ok: final PR=#$NUMBER open"
        ;;
      record)
        KEY="${1:?final-pr record needs <key>}"; CODE="${2:?final-pr record needs <exit-code>}"; NOTE="${3:-}"
        [[ "$CODE" =~ ^-?[0-9]+$ ]] || { echo "error: exit code must be numeric" >&2; exit 2; }
        jq -e '.final_pr.status=="open"' "$STATE" >/dev/null \
          || { echo "error: final PR is not open" >&2; exit 3; }
        write '.final_pr.evidence[$key]={exit:($code|tonumber),note:$note,at:(now|todate)}' \
          --arg key "$KEY" --arg code "$CODE" --arg note "$NOTE"
        echo "ok: final PR evidence[$KEY] exit=$CODE"
        ;;
      feedback-round)
        jq -e '.final_pr.status=="open"' "$STATE" >/dev/null \
          || { echo "error: final PR is not open" >&2; exit 3; }
        write '.final_pr.feedback_rounds+=1'
        echo "ok: final PR feedback-round=$(jq -r '.final_pr.feedback_rounds' "$STATE")"
        ;;
      ready)
        jq -e '.final_pr.status=="open" and .final_pr.evidence.ci.exit==0 and
          .final_pr.evidence.external_review.exit==0' "$STATE" >/dev/null \
          || { echo "error: passing CI and external-review evidence required" >&2; exit 3; }
        write '.final_pr.status="ready"'
        echo "ok: final PR decision-ready"
        ;;
      *) echo "error: final-pr action must be open|record|feedback-round|ready" >&2; exit 2;;
    esac
    ;;

  finish)
    require_state
    jq -e '.phase=="delivery" and .final_pr.status=="ready" and .story.accepted==true and
      ([.deviations[]?|select(.status=="open")]|length)==0' "$STATE" >/dev/null \
      || { echo "error: final PR, accepted Story, and resolved deviations required" >&2; exit 3; }
    write '.phase="done"'
    echo "ok: Quality Run complete"
    ;;

  *) echo "error: unknown command '$CMD'" >&2; exit 2;;
esac
