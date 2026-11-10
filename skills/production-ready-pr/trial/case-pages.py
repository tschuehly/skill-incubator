#!/usr/bin/env python3
"""One Markdown page per face-off case: every model's review side by side, each finding with the
adjudicator's label. Usage: case-pages.py [results-dir] [out-dir] [cases-file] | case-pages.py --selfcheck

Writes <out-dir>/<case>.md and index.md (default ~/.pi-workbench/evals/reports/prr-faceoff-cases), one per
case in cases-file (a campaign's cases JSON; default faceoff.json `cases`). Reads results
read-only and tolerates live runs: a torn last line in trials.jsonl, missing or half-written
adjudications, and findings not yet labelled (shown as pending).
"""
import glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
QUOTA = re.compile(r"usage limit reached|quota|rate limit|\b429\b", re.I)


def load_cases(cases_file):
    """A campaign's cases: cases_file plus one cases.d/<id>.json per registered case (faceoff.mjs readCasesFile)."""
    cases = json.load(open(cases_file)) if os.path.exists(cases_file) else []
    ids = {c["id"] for c in cases}
    extra = [json.load(open(f)) for f in glob.glob(os.path.join(os.path.dirname(cases_file), "cases.d", "*.json"))]
    return cases + sorted((c for c in extra if c["id"] not in ids), key=lambda c: (c.get("registeredAt", ""), c["id"]))


def load(results):
    trials = {}
    for line in open(os.path.join(results, "trials.jsonl")):
        try:
            r = json.loads(line)
        except ValueError:  # live run mid-append
            continue
        trials[r["key"]] = r
    adjs, finals = {}, {}
    for r in trials.values():
        c = r["case"]
        if c not in adjs:
            try:
                adjs[c] = json.load(open(os.path.join(results, "adjudications", c + ".json")))
            except (OSError, ValueError):
                adjs[c] = None
        try:
            finals[r["key"]] = open(os.path.join(results, "finals", f"{c}__{r['arm']}__{r['rep']}.txt")).read()
        except OSError:
            finals[r["key"]] = None
    return trials, adjs, finals


def cell(s):
    return " ".join(str(s).split()).replace("|", "\\|")


def pr_link(pr):
    return f"[{pr}](https://github.com/{pr.replace('#', '/pull/')})"


def judged(r):
    return r.get("status") == "done" and isinstance(r.get("findings"), list)


def quota_hit(text):
    return bool(text and QUOTA.search(text))


def labelled(adj):
    """Adjudicated items with their label merged in (label 'pending' when not yet labelled)."""
    if not adj:
        return []
    labels = {l["index"]: l for l in adj.get("labels", [])}
    out = []
    for it in adj.get("items", []):
        l = labels.get(it["index"], {"label": "pending", "cluster": f"item-{it['index']}", "reason": "not yet labelled"})
        out.append({**it, **{k: l.get(k, "") for k in ("label", "cluster", "reason")}})
    return out


def kind(label, defect_ids):
    if label in defect_ids:
        return f"known: {label}"
    return label


def finders(items, rows_key):
    """cluster -> sorted trial keys that reported it."""
    out = {}
    for it in items:
        out.setdefault(rows_key(it), set()).update(it["sources"])
    return out


def col(key):
    _, arm, rep = key.split("|")
    return f"{arm}/{rep}"


def render_case(case, trials, adj, finals):
    defect_ids = [d["id"] for d in case.get("defects", [])]
    items = labelled(adj)
    ts = sorted(trials, key=lambda r: (r["arm"], r["rep"]))
    cols = [r["key"] for r in ts if judged(r)]
    tags = (["exploratory"] if case.get("exploratory") else []) + ([] if defect_ids else ["blind: no answer key"])
    L = [f"# {case['id']}" + (f" ({', '.join(tags)})" if tags else ""), "",
         f"**PR:** {pr_link(case['pr'])}  ", f"**Provenance:** {cell(case.get('provenance', ''))}", ""]
    if defect_ids:
        L.append("**Known defects:**")
        L += [f"- `{d['id']}`: {cell(d['description'])}" for d in case["defects"]]
    else:
        L.append("**Known defects:** none (blind case; findings are judged valid or noise).")
    if adj is None:
        L += ["", "_No adjudication yet._"]

    # Problem matrix: one row per cluster; known defects first (missed ones too), then valid, pending, noise.
    rows = {}
    for it in items:
        row = rows.setdefault(it["cluster"], {"label": it["label"], "reason": it["reason"], "src": set()})
        row["src"].update(it["sources"])
    for d in defect_ids:
        if not any(r["label"] == d for r in rows.values()):
            rows[d] = {"label": d, "reason": "missed by every model", "src": set()}
    order = {"valid": 1, "pending": 2, "noise": 3}
    def rank(c):
        lab = rows[c]["label"]
        return (defect_ids.index(lab) if lab in defect_ids else 0, order.get(lab, 0), c)
    head = "| Problem | Label | " + " | ".join(col(k) for k in cols) + " | Reason |"
    sep = "|---|---|" + "---|" * len(cols) + "---|"
    def table(cs):
        out = [head, sep]
        for c in cs:
            r = rows[c]
            marks = " | ".join("✓" if k in r["src"] else "" for k in cols)
            out.append(f"| {cell(c)} | {cell(kind(r['label'], defect_ids))} | {marks} | {cell(r['reason'])} |")
        return out
    signal = sorted((c for c in rows if rows[c]["label"] != "noise"), key=lambda c: (rows[c]["label"] not in defect_ids, rank(c)))
    noise = sorted(c for c in rows if rows[c]["label"] == "noise")
    L += ["", "## Problem matrix", "", "Columns are `arm/rep`; ✓ means that trial reported the problem.", ""]
    L += table(signal) if signal else ["_No known or valid problems reported._"]
    if noise:
        L += ["", "### Noise", ""] + table(noise)

    # Per-model sections.
    L += ["", "## Reviews by model"]
    for r in ts:
        if not judged(r):
            continue
        k, text = r["key"], finals.get(r["key"])
        mine = [it for it in items if k in it["sources"]]
        L += ["", f"### {r['arm']} · rep {r['rep']}" + (" · **quota-hit**" if quota_hit(text) else ""), "",
              f"`{r.get('model')}` · effort {r.get('effort')} · {r.get('tokens') or 0:,} tokens · "
              f"{(r.get('wallMs') or 0) / 60000:.1f} min · list cost ${((r.get('usage') or {}).get('cost') or 0):.2f}", ""]
        seen = {(it["file"], it["line"], it["problem"]) for it in mine}
        pending = [f for f in r["findings"] if (f.get("file"), f.get("line"), f.get("problem")) not in seen][: max(0, len(r["findings"]) - len(mine))]
        if not mine and not pending:
            L.append("_No findings._")
        for it in mine:
            L.append(f"- `{it['file']}:{it['line']}` {cell(it['problem'])}  \n  → **{cell(kind(it['label'], defect_ids))}** "
                     f"(`{it['cluster']}`): {cell(it['reason'])}")
        for f in pending:
            L.append(f"- `{f.get('file')}:{f.get('line')}` {cell(f.get('problem', ''))}  \n  → **pending adjudication**")
        fence = "`" * max(3, 1 + max((len(m) for m in re.findall(r"`+", text or "")), default=0))
        L += ["", "<details><summary>Final review text</summary>", "", fence,
              (text or "(no final text)").rstrip(), fence, "", "</details>"]

    bad = [r for r in ts if not judged(r)]
    L += ["", "## Unjudged trials", ""]
    if not bad:
        L.append("_None._")
    for r in bad:
        text = finals.get(r["key"])
        why = r.get("reason") or (f"status {r.get('status')}" if r.get("status") != "done" else "no parseable findings")
        if not text:
            why += "; empty final text"
        flag = " **quota-hit**" if quota_hit(text) or r.get("rateLimited") and quota_hit(r.get("reason")) else ""
        L.append(f"- `{r['arm']}/{r['rep']}` ({r.get('status')}){flag}: {cell(why)}")
    return "\n".join(L) + "\n"


def quota_hits(trials, finals):
    return sorted(k for k, r in trials.items() if quota_hit(finals.get(k)) or (not judged(r) and r.get("rateLimited") and quota_hit(r.get("reason"))))


def index_line(case, trials, adj):
    defect_ids = [d["id"] for d in case.get("defects", [])]
    got = finders(labelled(adj), lambda it: it["label"])
    n = len(trials)
    head = f"- [{case['id']}]({case['id']}.md) · {pr_link(case['pr'])} · {n} trials"
    if not defect_ids:
        valid = {it["cluster"] for it in labelled(adj) if it["label"] == "valid"}
        return head + f" · blind: {len(valid)} valid problems"
    parts = [f"`{d}`: " + (", ".join(col(k) for k in sorted(got.get(d, ()))) or "nobody") for d in defect_ids]
    return head + (" · exploratory" if case.get("exploratory") else "") + " · " + "; ".join(parts)


def main(results, out=os.path.expanduser("~/.pi-workbench/evals/reports/prr-faceoff-cases"), cases_file=None):
    os.makedirs(out, exist_ok=True)
    cases = load_cases(cases_file) if cases_file else json.load(open(os.path.join(HERE, "faceoff.json")))["cases"]
    trials, adjs, finals = load(results)
    idx = ["# PRR face-off: case pages", "", "One line per PR: known defects and the `arm/rep` trials that found each.", ""]
    for c in cases:
        ts = [r for r in trials.values() if r["case"] == c["id"]]
        open(os.path.join(out, c["id"] + ".md"), "w").write(render_case(c, ts, adjs.get(c["id"]), finals))
        idx.append(index_line(c, ts, adjs.get(c["id"])))
    open(os.path.join(out, "index.md"), "w").write("\n".join(idx) + "\n")
    print(f"wrote {len(cases)} case pages + index.md to {out}")
    print("quota-hit:", ", ".join(quota_hits(trials, finals)) or "none")


def selfcheck():
    case = {"id": "c", "pr": "o/r#7", "provenance": "p", "defects": [{"id": "d1", "description": "bad"}, {"id": "d2", "description": "x"}]}
    t = lambda arm, rep, **kw: {"key": f"c|{arm}|{rep}", "case": "c", "arm": arm, "rep": rep, "model": "m/" + arm,
                                "effort": "low", "status": "done", "tokens": 1000, "wallMs": 120000, "usage": {"cost": 0.5}, **kw}
    f1 = {"file": "a.py", "line": 3, "problem": "p | one"}
    trials = [t("x", 0, findings=[f1, {"file": "b.py", "line": 9, "problem": "late"}]), t("y", 0, findings=[f1]),
              t("y", 1, findings=None), t("z", 0, status="error", findings=None, rateLimited=True, reason="429 quota")]
    adj = {"items": [{**f1, "index": 0, "sources": ["c|x|0", "c|y|0"]}, {"file": "n.py", "line": 1, "problem": "nit", "index": 1, "sources": ["c|y|0"]}],
           "labels": [{"index": 0, "label": "d1", "cluster": "k1", "reason": "real"}, {"index": 1, "label": "noise", "cluster": "n1", "reason": "style"}]}
    finals = {"c|x|0": "review ```code```", "c|y|0": "ok", "c|y|1": "Usage Limit Reached", "c|z|0": None}
    page = render_case(case, trials, adj, finals)
    assert "[o/r#7](https://github.com/o/r/pull/7)" in page
    assert "| k1 | known: d1 | ✓ | ✓ | real |" in page, page
    assert "| d2 | known: d2 |  |  | missed by every model |" in page
    assert page.index("### Noise") > page.index("| k1 |") and "| n1 | noise |  | ✓ | style |" in page
    assert "p \\| one" in page and "**pending adjudication**" in page and page.count("pending adjudication") == 1
    assert "````" in page  # fence longer than the backticks inside the final text
    assert "`y/1` (done) **quota-hit**: no parseable findings" in page
    assert "`z/0` (error) **quota-hit**: 429 quota; empty final text" in page
    assert "1.000 tokens" not in page and "1,000 tokens · 2.0 min · list cost $0.50" in page
    assert quota_hits({r["key"]: r for r in trials}, finals) == ["c|y|1", "c|z|0"]
    assert index_line(case, trials, adj).endswith("`d1`: x/0, y/0; `d2`: nobody")
    blind = render_case({**case, "defects": [], "exploratory": True}, trials, None, finals)
    assert "(exploratory, blind: no answer key)" in blind and "_No adjudication yet._" in blind
    import tempfile
    with tempfile.TemporaryDirectory(dir=os.environ.get("PI_TMP")) as d:
        os.makedirs(os.path.join(d, "cases.d"))
        json.dump([{"id": "a"}], open(os.path.join(d, "cases.json"), "w"))
        for c in [{"id": "a", "registeredAt": "0"}, {"id": "c", "registeredAt": "2"}, {"id": "b", "registeredAt": "1"}]:
            json.dump(c, open(os.path.join(d, "cases.d", c["id"] + ".json"), "w"))
        assert [c["id"] for c in load_cases(os.path.join(d, "cases.json"))] == ["a", "b", "c"]
        assert [c["id"] for c in load_cases(os.path.join(d, "missing.json"))] == ["a", "b", "c"]
    print("selfcheck ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selfcheck"]:
        selfcheck()
    else:
        main(*(sys.argv[1:] or [os.path.expanduser("~/.pi-workbench/evals/results/prr-faceoff")]))
