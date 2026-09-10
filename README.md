# skill-incubator

Source repository for Pi skills, prompt templates, and personal experimental extensions, with compatibility links for Claude Code and Codex. Incubate here, refine across projects, and publish skills to [jvm-skills](https://github.com/tschuehly/jvm-skills) once battle-tested.

## Why

This repository is the single source of truth. Linked global and project-local installations
resolve to the skill directories here.

## Layout

```
skills/<name>/SKILL.md               # the skill (+ scripts, references/)
skills/<name>/agents/*.md            # optional Claude Code per-role agents
skills/<name>/agents/*.toml          # optional Codex per-role agents
prompts/*.md                         # Pi prompt templates linked into ~/.pi/agent/prompts
extensions/<name>/index.ts           # experimental personal Pi extensions
vendored/<owner>/<name>/SKILL.md     # skills forked from an upstream installer
vendored/MANIFEST.json               # each vendored skill's pinned upstream revision and tree hash
link.sh                              # symlink a skill and its runtime-specific agents globally or into a project
```

`skills/` holds incubator-native skills. `prompts/` holds Pi prompt templates whose global installations link back to this repository. `extensions/` holds personal experiments that must not be mistaken for Pi Workbench managed execution. `vendored/` holds skills that came from an
external installer and were forked here so they can be edited and versioned; they are
grouped by upstream owner.
`link.sh` resolves a bare name across both trees, so `./link.sh tdd` works regardless of
which tree a skill lives in. Pass `<owner>/<name>` to disambiguate.

## Vendored skills

Externally maintained skills are copied into `vendored/` at an exact upstream revision. Global Pi, Codex, and Claude Code installations symlink to these directories, so the repository—not an installer-owned copy under `~/.agents/skills`—is the active source of truth.

This is a curated subset, not a mirror. `vendored/MANIFEST.json` is the roster and provenance record. To adopt another external skill, copy it under the upstream owner, add its pinned revision and tree hash to the manifest, then run `./link.sh <name>`.

Vendored content currently has **zero diff against upstream** — the fork buys the ability
to edit, not a set of edits. Keep it that way where you can: prefer composing an upstream
skill from an incubator skill over editing the upstream copy, so `vendored/` stays a clean
mirror. In particular, don't relax an upstream `disable-model-invocation: true` to make
one composition work — that flag marks a user-facing entry point, and clearing it makes
the skill model-invocable in *every* session. Compose what it delegates to instead.

This is a fork, and it has a price:

- **Upstream updates are deliberate.** Refresh the vendored tree from the pinned source, review the diff, update `sourceRevision` and `vendoredFromHash`, then relink.
- **Installers must not reclaim a name.** If behavior unexpectedly changes, verify `~/.agents/skills/<name>` first; Pi's global entry must resolve into this repository. Claude and Codex compatibility links should resolve to the same directory.

`vendored/MANIFEST.json` records each skill's upstream repository, exact source revision, path, and Git tree object. These fields make drift inspectable without relying on the retired global `.skill-lock.json`.

Skills that already live in a git repo you own are **not** vendored — that would create a
second source of truth. Link them straight at their checkout instead
(`your-own-skill-repo` → `~/IdeaProjects/your-own-skill-repo`; a product's own
skill family → that product's repository).

## Archived experiments

Retired runtime experiments remain as provenance, not installable capabilities. See the
[Claudex experiment archive](docs/archive/claudex/README.md); supported orchestration lives in Pi
Workbench.

## Workflow

1. **Incubate** — create/move a skill under `skills/<name>/`. Keep it general: no
   hardcoded project paths; scripts referenced as `<skill-dir>/…`; project conventions
   referenced via "the project's CLAUDE.md", not inlined.
2. **Link** — `./link.sh <name>` (global) or `./link.sh <name> ~/IdeaProjects/<project>`
   (project-local). The command links the skill into Claude, Codex, and Pi and installs
   each supported runtime's agent format. Global linking is usually enough; project-local is for
   skills that should ship with the repo or shadow the global installation.
3. **Refine** — edit here; every linked location picks the change up instantly. Commit
   the refinements with a note on what real-world usage taught.
4. **Publish** — when stable, upstream to jvm-skills via the `skill-sync` skill
   (a product repo's `.claude/skills/skill-sync`): it generalizes, extracts project overlays,
   creates the registry YAML, and sets up evals.

## Skills

| Skill | Status | Notes |
|-------|--------|-------|
| `contextual-annotations` | incubating | Places one expandable, viewport-safe review bubble per finding at a semantic live-UI anchor; supports dynamic HTMX/modal re-anchoring and before/after evidence without shipping review code in production. |
| `quality-loop` | incubating | One GitHub Issue → pre-run Design Atelier → autonomously implemented and adversarially reviewed semantic Chapters → post-run System Story Atelier → final integration PR. Script-enforced session scope, durable baseline/RED/GREEN evidence, deterministic change-shape manifests, review rounds, deviations, and delivery gates. |
| `agent-orchestration` | incubating | Coordinate a thin lead and bounded collaborators through validated model bindings, persistent/fresh/disposable lifecycles, durable checkpoints, and atomically acquired workspace/process leases. |
| `quota-axi` | incubating | Read raw Claude and Codex subscription windows with `quota-axi --json`; model orchestration interprets duration, reset time, model scope, and freshness. Read-only and policy-free. |
| `atelier` | incubating | Copy-owned HTML interaction kit with a complete shell, selectable context/decision/annotation/queue capabilities, durable feedback state, a monitor-owned live loop, and compact desktop/narrow verification. |
| `write-for-humans` | incubating | Makes documentation and other human-facing prose clear while preserving technical meaning, conditions, and uncertainty. |
