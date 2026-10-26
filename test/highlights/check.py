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
# Usage: python3 test/highlights/check.py  (from the grammar root)

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
QUERY = ROOT / "queries" / "highlights.scm"


def tree_sitter_cli():
    """Use the exact project version, including for standalone checker runs."""
    local = ROOT / "node_modules" / ".bin" / "tree-sitter"
    cli = os.environ.get("TREE_SITTER") or str(local)
    try:
        actual = subprocess.check_output([cli, "--version"], text=True).split()[1]
    except (OSError, subprocess.CalledProcessError, IndexError):
        sys.exit("tree-sitter CLI not available — run 'npm ci' in the grammar root")
    expected = json.loads((ROOT / "package.json").read_text())["devDependencies"]["tree-sitter-cli"]
    if actual != expected:
        sys.exit(f"expected tree-sitter CLI {expected}, got {actual} — run 'npm ci'")
    return cli


CLI = tree_sitter_cli()
ASSERT_RE = re.compile(r"^\s*//\s*(<-|\^)\s*([\w.]+)\s*$")
PATTERN_RE = re.compile(r"^\s*pattern:\s*(\d+)\s*$")
# multi-line captures print without the numeric index prefix
CAPTURE_RE = re.compile(
    r"^[ \t]*capture: (?:\d+ - )?([\w.]+), start: \((\d+), (\d+)\), end: \((\d+), (\d+)\)",
    re.MULTILINE,
)


def assertions(text):
    """Yield (row, UTF-8 byte column, capture) for each assertion comment."""
    # Tree-sitter rows count LF only, unlike str.splitlines(), which also
    # splits on Unicode separators that are ordinary text inside comments.
    lines = text.split("\n")
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
        if row < 0 or col >= len(lines[row]):
            raise ValueError(f"assertion at line {i + 1} does not point to a source character")
        yield row, len(lines[row][:col].encode("utf-8")), expected


def query_output(path):
    return subprocess.run(
        [CLI, "query", str(QUERY), str(path)],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout


def winning_captures(out):
    """Return winner(row, col): the highest-priority capture at a position.

    Priority follows nvim's rendering: captures from later query patterns
    override earlier ones, and within a pattern, later captures win.
    """
    spans = []
    pattern = -1
    seq = 0
    for line in out.split("\n"):
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


def doc_comment_spans_include_newline(path, out):
    """doc_comment tokens must extend through their newline (ending at column
    0 of the next row) — the markdown injection relies on those line
    boundaries so a `# heading` cannot bleed into following doc lines."""
    bad = 0
    lines = Path(path).read_bytes().split(b"\n")
    for m in CAPTURE_RE.finditer(out):
        name, sr, sc, er, ec = m.group(1), *map(int, m.groups()[1:])
        is_line_doc = sr < len(lines) and lines[sr][:sc].lstrip().startswith(b"///")
        if name != "comment.documentation" or not is_line_doc:
            continue
        # An EOF doc line has no newline to include. All other lines must
        # end exactly at the start of the following row.
        expected_end = (sr + 1, 0) if sr + 1 < len(lines) else (sr, len(lines[sr]))
        if (er, ec) != expected_end:
            print(
                f"FAIL {Path(path).name}: doc comment at {sr + 1}:{sc + 1} "
                f"ends at {(er, ec)}, expected {expected_end}"
            )
            bad += 1
    return bad


def main():
    failures = 0
    files = sorted(Path(__file__).resolve().parent.glob("*.move"))
    if not files:
        sys.exit("no highlight fixtures found")
    assertion_count = 0
    for f in files:
        text = f.read_bytes().decode("utf-8")
        out = query_output(f)
        winner = winning_captures(out)
        failures += doc_comment_spans_include_newline(f, out)
        for row, col, expected in assertions(text):
            assertion_count += 1
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
    if not assertion_count:
        sys.exit("no highlight assertions found")
    print(f"highlight assertions OK ({assertion_count} assertions in {len(files)} files)")


if __name__ == "__main__":
    main()
