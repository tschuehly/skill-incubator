#!/usr/bin/env python3
"""Every review set of live models: problems found, runtime, tokens, and whether the set is on the Pareto front.

Usage: VERIFY_DIR=<verify dir> combinations.py [results-dir] [cases-file] > combinations.md
Problems, minutes and tokens come from model-summary.py's set_stats: one cohort per set (rep 0, retired models excluded).
"""
import contextlib, io, itertools, os, runpy, sys

with contextlib.redirect_stdout(io.StringIO()):
    g = runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "model-summary.py"))
stats, ranked, live, n_cases = g["stats"], g["ranked"], g["live"], len(g["case_ids"])

rows = [(len(st["problems"]), st["minutes"], st["tokens"] / 1e6, k, s, st)
        for k in range(1, len(live) + 1) for s in itertools.combinations(live, k) for st in [stats(s)]]
front_pool = [r for r in rows if ranked(r[5])]

# shortcut: O(sets^2) Pareto scan, fine to ~12 live models (4k sets); sort-and-sweep if it gets slow.
def pareto(r):
    return ranked(r[5]) and not any(o is not r and o[0] >= r[0] and o[1] <= r[1] and o[2] <= r[2] and (o[0], -o[1], -o[2]) != (r[0], -r[1], -r[2]) for o in front_pool)

labels = "verified labels" if os.environ.get("VERIFY_DIR") else "first-judge labels"
print(f"# Every review set of up to {len(live)} models ({len(rows)} sets, {labels}, rep 0, {len(g['everyone'])} problems)\n")
print(f"Each set is measured on its cohort: the PRs every member reviewed (PRs column). Minutes: median over those PRs of the slowest member. "
      f"Only sets covering all {n_cases} PRs are ranked or on the Pareto front; partial sets are flagged and listed after them. "
      "Pareto: no other full-coverage set finds at least as many problems in at most the same minutes and tokens.\n")
print("| models | set | PRs | problems | median minutes | tokens/review | pareto |\n|---|---|---|---|---|---|---|")
for r in sorted(rows, key=lambda r: (r[3], not ranked(r[5]), -r[0], r[1])):
    flag = "" if r[5]["full"] else f" (partial: {r[5]['n']}/{n_cases} PRs)"
    print(f"| {r[3]} | {' + '.join(r[4])}{flag} | {r[5]['n']} | {r[0]} | {r[1]:.1f} | {r[2]:.1f}M | {'yes' if pareto(r) else ''} |")
