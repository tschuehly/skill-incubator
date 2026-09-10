---
name: quota-axi
description: Read or display raw Claude and Codex subscription quota without applying a recommendation policy. Use at session start, before large delegations or scarce specialists, and when configuring a Claude Code quota statusline.
---

# Raw quota input

`quota-axi` supplies provider facts to the active runtime's model orchestration. It does not choose
a provider, model, effort, or routing profile.

## Command

Run exactly:

```sh
quota-axi --json
```

The command is read-only. It does not mutate provider state or log in.

## Interpret the report

- Identify windows using `windowSeconds` and `resetsAt`; treat labels and IDs as hints.
- Codex currently has a weekly general window and no five-hour window. A cached `five_hour` ID with
  `windowSeconds: 604800` is a mislabeled weekly window.
- Treat the lowest relevant general window as that provider's limiting capacity.
- Apply `kind: model` windows only to the named model.
- Do not compare Claude and Codex percentages as equal absolute token quantities.
- Report `state.stale`, `refreshedAt`, and `state.error`. Do not begin a large fan-out from stale
  data.
- If a provider is unreadable, report it as unreadable; never guess.

Return the relevant raw windows and freshness. Pi Workbench's model-orchestration skill owns every
supported routing decision; this incubator no longer carries a duplicate.

## Statusline

Use `scripts/quota-statusline.mjs` as the Claude Code `statusLine.command`. It preserves the
existing `ccstatusline` output and appends compact percentages remaining for Claude session,
Claude week, Fable, and Codex week. `⚠` marks stale provider data. The statusline caches the raw
report for 60 seconds and never applies routing recommendations.

Configure Claude Code atomically with:

```sh
<skill-dir>/scripts/configure-statusline.mjs ~/.claude/settings.json
```

The configurator preserves a `.pre-quota-statusline` backup.

For a fresh Claude report, the user may need to run `quota-axi --allow-keychain-prompt` once and
approve the macOS Keychain dialog.
