---
name: code-history
description: Past PRs and issues behind existing code. Use before proposing, grilling, implementing, or reviewing a change to code with history, or when asked why code is the way it is.
---

# Code history

`<skill-dir>` is the directory containing this file. The script prints at most about 4k tokens of
Markdown: the top 5 PRs by owned lines, then recency, with each PR's body, maintainer review
comments on the same files, and the top 3 linked issues. It skips bots and mass-format commits, makes
only read-only GitHub calls, and prints git-only output with a note when `gh` or a GitHub remote is
missing.

- **Concept, grilling, and implementation** (no diff yet):
  `<skill-dir>/scripts/code-history --paths <files or dirs> [--keywords <old or new type names>]`.
- **Review:** `<skill-dir>/scripts/code-history --diff <base>` blames the lines the change touches
  or removes at the merge-base.

Read the output as **design intent** behind the code. Before reintroducing a type, name, or
behavior, check whether a listed PR removed it on purpose. Proceed against a stated decision only
when you cite that PR and say why the reason no longer holds.

Self-check: `<skill-dir>/scripts/test-code-history.py`.
