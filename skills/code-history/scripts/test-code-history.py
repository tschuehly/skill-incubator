#!/usr/bin/env python3
"""Self-check for code-history: ranking, caps, bot/format filtering, and the no-gh paths.

Builds a throwaway git repo under $PI_TMP and puts a stub `gh` first on PATH.
"""
import os, re, stat, subprocess, sys, tempfile

CLI = os.path.join(os.path.dirname(os.path.abspath(__file__)), "code-history")
root = tempfile.mkdtemp(prefix="code-history-", dir=os.environ.get("PI_TMP") or None)
repo, stubdir = os.path.join(root, "repo"), os.path.join(root, "bin")
os.makedirs(repo), os.makedirs(stubdir)

# Stub gh: auth succeeds unless GH_STUB_AUTH=fail; serves canned PRs and issues for acme/widget.
STUB = r'''#!/usr/bin/env python3
import json, os, re, sys
a = sys.argv[1:]
if a[:2] == ["auth", "status"]:
    sys.exit(1 if os.environ.get("GH_STUB_AUTH") == "fail" else 0)
if a[:1] == ["search"]:
    print(json.dumps([{"number": 99, "title": "Search hit", "url": "u", "state": "closed"}])); sys.exit()
assert a[:3] == ["api", "-X", "GET"], a  # read-only
path = a[3]
if "/commits/" in path: print("[]"); sys.exit()
m = re.match(r"repos/acme/widget/pulls/(\d+)(/comments)?", path)
if m and m[2]:
    c = [{"path": "w.txt", "author_association": "MEMBER", "user": {"login": "maint", "type": "User"}, "body": f"comment {i}"} for i in range(8)]
    c += [{"path": "w.txt", "author_association": "MEMBER", "user": {"login": "copilot", "type": "Bot"}, "body": "BOTCOMMENT"},
          {"path": "other.txt", "author_association": "MEMBER", "user": {"login": "maint", "type": "User"}, "body": "OTHERFILE"},
          {"path": "w.txt", "author_association": "NONE", "user": {"login": "rando", "type": "User"}, "body": "OUTSIDER"}]
    print(json.dumps(c)); sys.exit()
if m:
    n = int(m[1])
    print(json.dumps({"number": n, "title": f"PR title {n}", "body": f"Fixes #3, see #4. " + "x" * 2000,
                      "user": {"login": "dev", "type": "User"}, "merged_at": None if n == 11 else "2026-01-01T00:00:00Z",
                      "html_url": f"https://github.com/acme/widget/pull/{n}"})); sys.exit()
m = re.match(r"repos/acme/widget/issues/(\d+)", path)
if m:
    n = int(m[1])
    d = {"number": n, "title": f"Issue title {n}", "body": "why", "state": "closed", "user": {"type": "User"},
         "html_url": f"https://github.com/acme/widget/issues/{n}"}
    if n == 4: d["pull_request"] = {}
    print(json.dumps(d)); sys.exit()
sys.exit(1)
'''
with open(os.path.join(stubdir, "gh"), "w") as f:
    f.write(STUB)
os.chmod(os.path.join(stubdir, "gh"), 0o755)


def sh(*cmd, env=None):
    return subprocess.run(cmd, cwd=repo, check=True, capture_output=True, text=True, env=env).stdout


def write(name, lines):
    open(os.path.join(repo, name), "w").write("\n".join(lines) + "\n")


stamp = [1700000000]


def commit(author, subject, lines=None, start=0):
    if lines is not None:
        path = os.path.join(repo, "w.txt")
        old = open(path).read().splitlines() if os.path.exists(path) else []
        old += [""] * max(0, start + len(lines) - len(old))
        old[start:start + len(lines)] = lines
        write("w.txt", old)
    sh("git", "add", "-A")
    stamp[0] += 100  # distinct fixed dates: ranking ties break by commit time, never by wall-clock seconds
    date = f"{stamp[0]} +0000"
    sh("git", "-c", f"user.name={author}", "-c", f"user.email={author}@x.io", "commit", "-qm", subject,
       env=dict(os.environ, GIT_AUTHOR_DATE=date, GIT_COMMITTER_DATE=date))


sh("git", "init", "-q", "-b", "main")
sh("git", "remote", "add", "origin", "https://github.com/acme/widget.git")
commit("alice", "Add widget core (#10)", [f"core {i}" for i in range(40)])
commit("dependabot[bot]", "Bump deps (#20)", [f"bot {i}" for i in range(30)], 40)
commit("carol", "Reformat all sources (#21)", [f"fmt {i}" for i in range(25)], 70)
for k, n in enumerate(range(11, 18)):  # seven small PRs, fewer lines each, to exercise the top-5 cap
    commit("bob", f"Tweak {n} (#{n})", [f"tweak {n} {i}" for i in range(10 - k)], 100 + sum(range(10, 10 - k, -1)))  # contiguous: no gap blanks to even out counts
commit("dave", "Direct fix for #5", ["direct"], 200)
sh("git", "branch", "base")
commit("erin", "Change core", [f"changed {i}" for i in range(3)], 2)

env = dict(os.environ, PATH=stubdir + os.pathsep + os.environ["PATH"])


def cli(*args, **extra):
    return sh(CLI, *args, env=dict(env, **extra))


# Paths mode with gh: ranking by owned lines, bot and format commits dropped, caps.
out = cli("--paths", "w.txt", "--keywords", "widget")
heads = re.findall(r"^### #(\d+)", out.split("## Issues")[0], re.M)
assert heads == ["10", "11", "12", "13", "14"], heads            # ownership order, capped at 5
assert "#20" not in out and "#21" not in out, "bot/format leaked"
assert "x" * 601 not in out and "x" * 500 in out, "body cap"
assert out.count("- review @maint") == 5 * 5, "≤5 maintainer comments per PR"
assert "BOTCOMMENT" not in out and "OTHERFILE" not in out and "OUTSIDER" not in out
assert "### #3 Issue title 3" in out and "Issue title 4" not in out   # PR-backed #4 is not an issue
assert "Direct fix for #5" in out and "### #5 Issue title 5" in out   # commit with no PR still links its issue
assert "#99 Search hit" in out
assert len(out) <= 16100
assert re.search(r"^### #11 .*\n\d+ lines · 2023-", out, re.M), "open PR (merged_at null) falls back to the commit date"

# Diff mode: only lines erin changed, blamed at the merge-base -> alice's PR.
out = cli("--diff", "base")
heads = re.findall(r"^### #(\d+)", out, re.M)
assert heads[:1] == ["10"] and "3 touched or removed lines" in out, out[:400]

# No gh auth: git-only output with a note, PR numbers from subjects.
out = cli("--paths", "w.txt", GH_STUB_AUTH="fail")
assert "not authenticated" in out and "https://github.com" not in out
assert re.findall(r"^### #(\d+)", out, re.M)[:2] == ["10", "11"]
assert "Referenced (unverified): #" in out

# Non-GitHub remote.
sh("git", "remote", "set-url", "origin", "https://gitlab.com/acme/widget.git")
out = cli("--paths", "w.txt")
assert "No GitHub remote" in out and "### #10" in out
sh("git", "remote", "set-url", "origin", "https://github.com/acme/widget.git")

# Diff mode edge cases: a deleted SQL comment, a non-ASCII filename, and more files than the cap.
write("q.sql", ["-- comment", "select 1", "a", "b", "c", "last"])
commit("frank", "Add query (#30)")
write("café.txt", [f"café {i}" for i in range(5)])
commit("gina", "Add cafe (#31)")
for i in range(31):
    write(f"f{i:02}.txt", [f"f {i}"])
commit("hank", "Add many (#32)")
sh("git", "branch", "base2")
write("q.sql", ["select 1", "a", "b", "c", "LAST"])                      # two hunks: deleted comment, changed last line
write("café.txt", ["café 0", "CAFÉ 1", "CAFÉ 2", "café 3", "café 4"])
for i in range(31):
    write(f"f{i:02}.txt", [f"F {i}"])
commit("ivan", "Edit all")
out = cli("--diff", "base2")
assert re.search(r"^### #30 .*\n2 lines", out, re.M), "second hunk after a deleted -- comment was lost"
assert re.search(r"^### #31 .*\n2 lines", out, re.M), "quoted non-ASCII path blamed zero lines"
assert re.search(r"omitted 3 files: f\d\d\.txt, f\d\d\.txt, f\d\d\.txt$", out, re.M), "cap must name omitted files"
assert re.search(r"^### #32 .*\n28 lines", out, re.M), out[:600]

print("code-history self-check: PASS")
