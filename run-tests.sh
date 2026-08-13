#!/bin/bash
# Copyright (c) The Move Contributors
# SPDX-License-Identifier: Apache-2.0

set -e
shopt -s globstar
cd "$(dirname "$0")"

# When this repo lives inside the Sui monorepo layout, also sweep the
# framework sources; standalone checkouts skip that part.
SUI_FRAMEWORK_ROOT="../../../../crates/sui-framework/packages"

# Fail on stale conflict declarations (generate warns about them).
gen_out=$(tree-sitter generate 2>&1) || { echo "$gen_out"; exit 1; }
if echo "$gen_out" | grep -q "unnecessary conflicts"; then
    echo "$gen_out"
    echo "FAILED: grammar.js declares unnecessary conflicts"
    exit 1
fi

# Tree-shape regression tests (test/corpus).
tree-sitter test

# Highlight assertion tests (test/highlights).
python3 test/highlights/check.py

# Scanner invariants that only surface on a modern tree-sitter runtime (the
# rust dev-dependency pins 0.25), so `tree-sitter test` cannot express them.
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
failures=$(tree-sitter parse -q "${sweep[@]}" 2>/dev/null || true)
if [ -n "$failures" ]; then
    echo "$failures"
    echo "FAILED: some files did not parse cleanly"
    exit 1
fi
echo "OK: all files parsed cleanly"
