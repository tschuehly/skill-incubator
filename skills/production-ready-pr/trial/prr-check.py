#!/usr/bin/env python3
"""Face-off check: the review must end with a parseable findings block. Scoring is the pooled adjudication.

Reads FINAL_TEXT; prints `findings: N` and FINDINGS=<json>. Exit 0 = parseable block, 1 = none.
"""
import json, os, re, sys

text = open(os.environ["FINAL_TEXT"]).read()
for block in reversed(re.findall(r"```(?:json)?\s*(\[[\s\S]*?\])\s*```", text)):
    try:
        value = json.loads(block)
    except Exception:
        continue
    if isinstance(value, list):
        findings = [f for f in value if isinstance(f, dict)]
        print(f"findings: {len(findings)}")
        print("FINDINGS=" + json.dumps(findings, ensure_ascii=False))
        sys.exit(0)
print("no parseable findings block")
sys.exit(1)
