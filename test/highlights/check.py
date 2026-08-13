# Copyright (c) The Move Contributors
# SPDX-License-Identifier: Apache-2.0
#
# Highlight assertion checker for the .move files in this directory.
#
# Assertions use tree-sitter's own highlight-test comment syntax:
#
#     constants::b9_scaling!();
#     // <- namespace.module.name
#     //         ^ function.macro
#
# `<-` asserts on the character directly above the first `/` of the comment;
# `^` asserts on the character directly above the caret. The expected capture
# must be the *winning* capture at that position — the last one the highlights
# query produces, which is what nvim renders. (`tree-sitter test` can't run
# these because its loader requires a globally configured, conventionally
# named parser directory.)
#
# Usage: python3 test/highlight/check.py  (from the grammar root)

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
QUERY = ROOT / "queries" / "highlights.scm"


def tree_sitter_cli():
    """The CLI version matters — see the comment in run-tests.sh. Prefer the
    one pinned in package.json over whatever a distro put on PATH."""
    local = ROOT / "node_modules" / ".bin" / "tree-sitter"
    if local.is_file() and os.access(local, os.X_OK):
        return str(local)
    found = os.environ.get("TREE_SITTER") or shutil.which("tree-sitter")
    if not found:
        sys.exit("tree-sitter CLI not found — run 'npm install' in the grammar root")
    return found


CLI = tree_sitter_cli()
ASSERT_RE = re.compile(r"^\s*//\s*(<-|\^)\s*([\w.]+)\s*$")
PATTERN_RE = re.compile(r"pattern:\s*(\d+)")
# multi-line captures print without the numeric index prefix
CAPTURE_RE = re.compile(
    r"capture: (?:\d+ - )?([\w.]+), start: \((\d+), (\d+)\), end: \((\d+), (\d+)\)"
)


def assertions(text):
    """Yield (row, col, expected_capture) for each assertion comment."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = ASSERT_RE.match(line)
        if not m:
            continue
        marker, expected = m.groups()
        col = line.index("//") if marker == "<-" else line.index("^")
        # the assertion applies to the nearest non-assertion line above
        row = i - 1
        while row >= 0 and ASSERT_RE.match(lines[row]):
            row -= 1
        yield row, col, expected


def winning_captures(path):
    """Return winner(row, col): the highest-priority capture at a position.

    Priority follows nvim's rendering: captures from later query patterns
    override earlier ones, and within a pattern, later captures win.
    """
    out = subprocess.run(
        [CLI, "query", str(QUERY), str(path)],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout
    spans = []
    pattern = -1
    seq = 0
    for line in out.splitlines():
        pm = PATTERN_RE.search(line)
        if pm:
            pattern = int(pm.group(1))
            continue
        cm = CAPTURE_RE.search(line)
        if cm:
            name, sr, sc, er, ec = cm.group(1), *map(int, cm.groups()[1:])
            seq += 1
            if not name.startswith("_"):
                spans.append(((pattern, seq), name, sr, sc, er, ec))

    def winner(row, col):
        # nvim applies parent captures before child captures, so a narrower
        # (deeper) span wins over a wider one; for identical spans the later
        # query pattern wins.
        best = None
        for prio, name, sr, sc, er, ec in spans:
            if (sr, sc) <= (row, col) < (er, ec):
                size = (er - sr, ec - sc if er == sr else ec)
                key = (-size[0], -size[1], prio[0], prio[1])
                if best is None or key > best[0]:
                    best = (key, name)
        return best[1] if best else None

    return winner


def doc_comment_spans_include_newline(path):
    """doc_comment tokens must extend through their newline (ending at column
    0 of the next row) — the markdown injection relies on those line
    boundaries so a `# heading` cannot bleed into following doc lines."""
    out = subprocess.run(
        [CLI, "query", str(QUERY), str(path)],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout
    bad = 0
    lines = Path(path).read_text().splitlines()
    for m in CAPTURE_RE.finditer(out):
        name, sr, sc, er, ec = m.group(1), *map(int, m.groups()[1:])
        is_line_doc = sr < len(lines) and lines[sr][:sc].lstrip().startswith("///")
        if name == "comment.documentation" and is_line_doc and sr == er:
            print(
                f"FAIL {Path(path).name}: doc comment at {sr + 1}:{sc + 1} "
                f"does not include its trailing newline"
            )
            bad += 1
    return bad


def main():
    failures = 0
    files = sorted(Path(__file__).resolve().parent.glob("*.move"))
    for f in files:
        text = f.read_text()
        winner = winning_captures(f)
        failures += doc_comment_spans_include_newline(f)
        for row, col, expected in assertions(text):
            actual = winner(row, col)
            if actual != expected:
                failures += 1
                print(
                    f"FAIL {f.name}:{row + 1}:{col + 1}: "
                    f"expected `{expected}`, got `{actual}`"
                )
    if failures:
        print(f"{failures} highlight assertion(s) failed")
        sys.exit(1)
    print(f"highlight assertions OK ({len(files)} files)")


if __name__ == "__main__":
    main()
