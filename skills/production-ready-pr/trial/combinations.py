#!/usr/bin/env python3
"""Every review set of live models: problems found, runtime, tokens, and whether the set is on the Pareto front.

Usage: VERIFY_DIR=<verify dir> combinations.py [results-dir] [cases-file] > combinations.md
Problems, minutes and tokens come from model-summary.py (rep 0, retired models excluded).
"""
import contextlib, io, itertools, os, runpy, sys

with contextlib.redirect_stdout(io.StringIO()):
    g = runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "model-summary.py"))
P, M, live, tok = g["problems"], g["set_minutes"], g["live"], g["tok"]

rows = [(len(set().union(*(P(a) for a in s))), M(s), sum(tok[a] for a in s) / 1e6, k, s)
        for k in range(1, len(live) + 1) for s in itertools.combinations(live, k)]

# shortcut: O(sets^2) Pareto scan, fine to ~12 live models (4k sets); sort-and-sweep if it gets slow.
def pareto(r):
    return not any(o is not r and o[0] >= r[0] and o[1] <= r[1] and o[2] <= r[2] and (o[0], -o[1], -o[2]) != (r[0], -r[1], -r[2]) for o in rows)

labels = "verified labels" if os.environ.get("VERIFY_DIR") else "first-judge labels"
print(f"# Every review set of up to {len(live)} models ({len(rows)} sets, {labels}, rep 0, {len(g['everyone'])} problems)\n")
print("Minutes: median over PRs of the slowest member. Pareto: no other set finds at least as many problems in at most the same minutes and tokens.\n")
print("| models | set | problems | median minutes | tokens/review | pareto |\n|---|---|---|---|---|---|")
for r in sorted(rows, key=lambda r: (r[3], -r[0], r[1])):
    print(f"| {r[3]} | {' + '.join(r[4])} | {r[0]} | {r[1]:.1f} | {r[2]:.1f}M | {'yes' if pareto(r) else ''} |")
