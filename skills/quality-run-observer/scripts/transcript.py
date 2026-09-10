#!/usr/bin/env python3
"""transcript.py — read-only reader for an observed session transcript.

The transcript is the ground truth for what an agent *did* and what it *considered*. Absence of a
tool call proves the tool was not used; absence of a keyword across text and thinking proves the
idea was never entertained. Both are findings.

  transcript.py <session.jsonl> census              tool counts, agent types, entry total
  transcript.py <session.jsonl> agents              every Agent/SendMessage dispatch, chronological
  transcript.py <session.jsonl> grep <regex>        search assistant text AND thinking (finds absence)
  transcript.py <session.jsonl> tool <name>         every call to one tool, with inputs
  transcript.py <session.jsonl> read <start> [n]    replay entries from an index
"""
import json
import re
import sys
from collections import Counter


def load(path):
    rows = []
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    return rows


def blocks(row):
    msg = row.get("message") or {}
    content = msg.get("content")
    return content if isinstance(content, list) else []


def stamp(row):
    return (row.get("timestamp") or "")[11:19]


def census(rows):
    tools, agents = Counter(), Counter()
    for row in rows:
        for b in blocks(row):
            if b.get("type") == "tool_use":
                tools[b.get("name")] += 1
                if b.get("name") == "Agent":
                    agents[(b.get("input") or {}).get("subagent_type")] += 1
    print(f"entries: {len(rows)}")
    print("--- tool calls ---")
    for name, n in tools.most_common():
        print(f"{n:5d}  {name}")
    if agents:
        print("--- agents by type ---")
        for name, n in agents.most_common():
            print(f"{n:5d}  {name}")


def agents_timeline(rows):
    for row in rows:
        for b in blocks(row):
            if b.get("type") != "tool_use" or b.get("name") not in ("Agent", "SendMessage"):
                continue
            i = b.get("input") or {}
            label = i.get("subagent_type") or "(resume)"
            detail = i.get("description") or i.get("summary") or ""
            print(f"{stamp(row)}  {b.get('name'):12} {label:40} "
                  f"model={str(i.get('model', '-')):16} bg={i.get('run_in_background')}  {str(detail)[:48]}")


def grep(rows, pattern):
    rx = re.compile(pattern)
    hits = 0
    for idx, row in enumerate(rows):
        if row.get("type") != "assistant":
            continue
        for b in blocks(row):
            text = b.get("text") if b.get("type") == "text" else b.get("thinking", "") if b.get("type") == "thinking" else ""
            if not text or not rx.search(text):
                continue
            hits += 1
            m = rx.search(text)
            lo, hi = max(0, m.start() - 300), min(len(text), m.end() + 300)
            print(f"--- [{idx}] {b.get('type')} {stamp(row)}\n    ...{text[lo:hi]}...\n")
    print(f"blocks matching /{pattern}/ across text and thinking: {hits}")
    if hits == 0:
        print("ZERO matches: the idea never entered the session's reasoning.")


def tool(rows, name):
    n = 0
    for idx, row in enumerate(rows):
        for b in blocks(row):
            if b.get("type") == "tool_use" and b.get("name") == name:
                n += 1
                print(f"--- [{idx}] {stamp(row)}\n{json.dumps(b.get('input'), indent=1)[:1200]}")
    print(f"{name} calls: {n}")


def read(rows, start, limit):
    for idx, row in enumerate(rows[start:start + limit], start=start):
        if row.get("type") not in ("assistant", "user"):
            continue
        for b in blocks(row):
            t = b.get("type")
            if t == "text":
                print(f"--- [{idx}] {row.get('type')} {stamp(row)} TEXT\n{b['text'][:900]}")
            elif t == "tool_use":
                print(f"--- [{idx}] {stamp(row)} TOOL_USE {b.get('name')}\n{json.dumps(b.get('input'), indent=1)[:700]}")
            elif t == "tool_result":
                c = b.get("content")
                print(f"--- [{idx}] {stamp(row)} RESULT\n{(c if isinstance(c, str) else json.dumps(c))[:700]}")


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    rows, cmd = load(sys.argv[1]), sys.argv[2]
    if cmd == "census":
        census(rows)
    elif cmd == "agents":
        agents_timeline(rows)
    elif cmd == "grep":
        grep(rows, sys.argv[3])
    elif cmd == "tool":
        tool(rows, sys.argv[3])
    elif cmd == "read":
        read(rows, int(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 40)
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main()
