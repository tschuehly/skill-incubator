#!/usr/bin/env python3
"""Append the verified problems that ratings/problems.json lacks, and list what each rater has not rated.

Usage: VERIFY_DIR=<verify dir> build-problems.py <ratings dir> [results-dir] [cases-file] | build-problems.py --selfcheck

A problem is one <case>::<cluster> with at least one non-noise label after the verify verdicts replace the
first judge's labels; a label moved onto a known defect joins that defect's cluster. This is model-summary.py's
VERIFY_DIR rule, so the ids are the ones weighted-sets.py looks up. Existing entries are never changed.
"""
import glob, importlib.util, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RATERS = ("opus", "sol")


def problems(case, adj, verdicts):
    """Entries for one case: case is its faceoff.json definition, verdicts {index: verdict}."""
    items = {i["index"]: i for i in adj["items"]}
    clusters = {}
    for l in adj["labels"]:
        lab = verdicts.get(l["index"], {}).get("label", l["label"])
        if lab != "noise":
            clusters.setdefault(lab if lab != "valid" else l["cluster"], []).append(l)
    defects = {d["id"]: d["description"] for d in case.get("defects", [])}
    return [{"id": f"{case['id']}::{cl}", "case": case["id"], "pr": case["pr"], "repo": case["repo"], "base": case["base"],
             "proposed": case["proposed"], "knownDefect": defects.get(cl),
             "findings": [{k: items[l["index"]][k] for k in ("file", "line", "problem")} for l in ls[:3]],
             "judgeReason": ls[0]["reason"], "verifierEvidence": verdicts.get(ls[0]["index"], {}).get("evidence")}
            for cl, ls in clusters.items()]


def merge(existing, derived):
    """existing plus the derived entries whose id is new, existing entries untouched."""
    have = {e["id"] for e in existing}
    return existing + [e for e in derived if e["id"] not in have]


def selfcheck():
    case = {"id": "c", "pr": "o/r#1", "repo": "r", "base": "b", "proposed": "p", "defects": [{"id": "d1", "description": "known bad"}]}
    it = lambda i: {"index": i, "file": f"f{i}", "line": i, "problem": f"p{i}", "sources": []}
    # items out of index order: joining on position would pair labels with the wrong findings
    adj = {"items": [it(3), it(2), it(1), it(0)],
           "labels": [{"index": 0, "label": "valid", "cluster": "a", "reason": "r0"}, {"index": 1, "label": "noise", "cluster": "b", "reason": "r1"},
                      {"index": 2, "label": "valid", "cluster": "e", "reason": "r2"}, {"index": 3, "label": "noise", "cluster": "z", "reason": "r3"}]}
    v = {0: {"label": "valid", "evidence": "e0"}, 1: {"label": "valid", "evidence": "e1"}, 2: {"label": "d1", "evidence": "e2"}, 3: {"label": "noise", "evidence": "e3"}}
    ps = {e["id"]: e for e in problems(case, adj, v)}
    assert set(ps) == {"c::a", "c::b", "c::d1"}, ps  # noise->valid counts, valid->known joins d1, noise stays out
    assert ps["c::d1"]["knownDefect"] == "known bad" and ps["c::a"]["knownDefect"] is None
    assert ps["c::b"]["findings"] == [{"file": "f1", "line": 1, "problem": "p1"}] and ps["c::b"]["verifierEvidence"] == "e1"
    assert ps["c::a"]["judgeReason"] == "r0"
    old = [{"id": "c::a", "keep": True}]
    m = merge(old, list(ps.values()))
    assert m[0] == {"id": "c::a", "keep": True} and [e["id"] for e in m] == ["c::a", "c::b", "c::d1"]
    assert merge(m, list(ps.values())) == m  # idempotent
    print("selfcheck ok")


def main(ratings, results=os.path.expanduser("~/.pi-workbench/evals/results/prr-faceoff"), cases_file=None):
    vdir = os.environ.get("VERIFY_DIR") or sys.exit("set VERIFY_DIR to the verify dir")
    if cases_file:
        spec = importlib.util.spec_from_file_location("case_pages", os.path.join(HERE, "case-pages.py"))
        cp = importlib.util.module_from_spec(spec); spec.loader.exec_module(cp)
        cases = cp.load_cases(cases_file)
    else:
        cases = json.load(open(os.path.join(HERE, "faceoff.json")))["cases"]
    derived = []
    for c in cases:
        af, vf = os.path.join(results, "adjudications", c["id"] + ".json"), os.path.join(vdir, c["id"] + ".json")
        if not os.path.exists(af):
            continue
        if not os.path.exists(vf):
            print(f"unverified (no {vf}): skipped {c['id']}")
            continue
        adj, v = json.load(open(af)), {x["index"]: x for x in json.load(open(vf))["verdicts"]}
        missing = sorted({l["index"] for l in adj["labels"]} - set(v))
        if missing:
            print(f"{c['id']}: no verdict for label index {missing}; the first judge's label stands")
        derived += problems(c, adj, v)
    pf = os.path.join(ratings, "problems.json")
    existing = json.load(open(pf)) if os.path.exists(pf) else []
    merged = merge(existing, derived)
    if len(merged) > len(existing):
        tmp = pf + ".tmp"
        json.dump(merged, open(tmp, "w"), indent=1)
        os.replace(tmp, pf)
    stale = sorted({e["id"] for e in existing} - {e["id"] for e in derived})
    print(f"problems.json: {len(existing)} existing, {len(merged) - len(existing)} added, {len(merged)} total")
    if stale:
        print(f"no longer derived (kept; check the verify files): {', '.join(stale)}")
    raters = sorted(set(RATERS) | {os.path.basename(f)[:-5] for f in glob.glob(os.path.join(ratings, "*.json"))} - {"problems"})
    for r in raters:
        rf = os.path.join(ratings, r + ".json")
        rated = {x["id"] for x in json.load(open(rf))["ratings"]} if os.path.exists(rf) else set()
        todo = [e["id"] for e in merged if e["id"] not in rated]
        print(f"unrated by {r}: {len(todo)}" + (f": {', '.join(todo)}" if todo else ""))


if __name__ == "__main__":
    if sys.argv[1:] == ["--selfcheck"]:
        selfcheck()
    elif not sys.argv[1:] or len(sys.argv) > 4:
        sys.exit(__doc__)
    else:
        main(*sys.argv[1:])
