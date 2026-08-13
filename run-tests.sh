#!/bin/bash
# Copyright (c) The Move Contributors
# SPDX-License-Identifier: Apache-2.0

set -e
shopt -s globstar
cd "$(dirname "$0")"

# The CLI version matters: `tree-sitter generate` rewrites src/parser.c,
# src/grammar.json, src/node-types.json and src/tree_sitter/parser.h, and an
# older CLI silently downgrades all four (0.20.x emits a pre-ABI-15 format and
# drops grammar.json's `$schema`/`reserved` keys). Distros ship stale ones —
# Debian's tree-sitter-cli is 0.20.8 — so never trust a bare `tree-sitter` off
# PATH. Resolve the version pinned in package.json instead, installing it on
# first run.
TS_MIN_MAJOR_MINOR="0.26"
TS=node_modules/.bin/tree-sitter

if [ ! -x "$TS" ]; then
    echo "tree-sitter-cli not installed locally, running npm install..."
    npm install --no-audit --no-fund
fi

ts_version=$("$TS" --version | awk '{print $2}')
case "$ts_version" in
    "$TS_MIN_MAJOR_MINOR".*) ;;
    *)
        echo "FAILED: expected tree-sitter-cli $TS_MIN_MAJOR_MINOR.x, got $ts_version"
        echo "Run 'npm install' to get the version pinned in package.json."
        exit 1
        ;;
esac

# When this repo lives inside the Sui monorepo layout, also sweep the
# framework sources; standalone checkouts skip that part.
SUI_FRAMEWORK_ROOT="../../../../crates/sui-framework/packages"

# Fail on stale conflict declarations (generate warns about them).
gen_out=$("$TS" generate 2>&1) || { echo "$gen_out"; exit 1; }
if echo "$gen_out" | grep -q "unnecessary conflicts"; then
    echo "$gen_out"
    echo "FAILED: grammar.js declares unnecessary conflicts"
    exit 1
fi

# Generated sources are committed, so the regeneration above should be a no-op
# on a clean tree. If it moved anything, say so — those files need committing
# alongside the grammar.js change that caused them.
if ! git diff --quiet -- src/ 2>/dev/null; then
    echo "NOTE: regeneration changed src/ — commit these along with grammar.js:"
    git diff --stat -- src/
fi

# Tree-shape regression tests (test/corpus).
"$TS" test

# Highlight assertion tests (test/highlights).
python3 test/highlights/check.py

# Scanner invariants that only surface on a modern tree-sitter runtime (the
# rust dev-dependency tracks the CLI), so `tree-sitter test` cannot express
# them — a zero-width token is invisible to an older runtime.
if command -v cargo >/dev/null 2>&1; then
    cargo test --quiet
else
    echo "SKIP: cargo not found, skipping runtime invariant tests"
fi

# `parse -q` only prints files whose parse contains errors, so any output here
# is a failure.
sweep=(tests/*.move)
if [ -d "$SUI_FRAMEWORK_ROOT" ]; then
    sweep+=("$SUI_FRAMEWORK_ROOT"/sui-framework/**/*.move)
    sweep+=("$SUI_FRAMEWORK_ROOT"/move-stdlib/**/*.move)
fi
failures=$("$TS" parse -q "${sweep[@]}" 2>/dev/null || true)
if [ -n "$failures" ]; then
    echo "$failures"
    echo "FAILED: some files did not parse cleanly"
    exit 1
fi
echo "OK: all files parsed cleanly"
