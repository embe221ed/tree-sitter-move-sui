#!/bin/bash
# Copyright (c) The Move Contributors
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail
shopt -s globstar nullglob
cd "$(dirname "$0")"

# The CLI version matters: `tree-sitter generate` rewrites src/parser.c,
# src/grammar.json, src/node-types.json and src/tree_sitter/parser.h, and an
# older CLI silently downgrades all four (0.20.x emits a pre-ABI-15 format and
# drops grammar.json's `$schema`/`reserved` keys). Distros ship stale ones —
# Debian's tree-sitter-cli is 0.20.8 — so never trust a bare `tree-sitter` off
# PATH. Resolve the version pinned in package.json instead, installing it on
# first run.
TS_VERSION=$(node -p 'require("./package.json").devDependencies["tree-sitter-cli"]')
TS=node_modules/.bin/tree-sitter

if [ ! -x "$TS" ]; then
    echo "tree-sitter-cli not installed locally, running npm ci..."
    npm ci --no-audit --no-fund
fi

ts_version=$("$TS" --version | awk '{print $2}')
if [ "$ts_version" != "$TS_VERSION" ]; then
    echo "FAILED: expected tree-sitter-cli $TS_VERSION, got $ts_version"
    echo "Run 'npm ci' to get the version pinned in package.json."
    exit 1
fi

# When this repo lives inside the Sui monorepo layout, also sweep the
# framework sources; standalone checkouts skip that part.
if [ "${SUI_FRAMEWORK_ROOT+x}" = x ] && [ ! -d "$SUI_FRAMEWORK_ROOT" ]; then
    echo "FAILED: SUI_FRAMEWORK_ROOT is not a directory: $SUI_FRAMEWORK_ROOT" >&2
    exit 1
fi
SUI_FRAMEWORK_ROOT=${SUI_FRAMEWORK_ROOT:-../../../../crates/sui-framework/packages}

# Verify the runner itself catches failures, including stderr-only CLI errors.
python3 -m unittest discover -s test/tooling -p 'test_*.py'

# Fail on stale conflict declarations (generate warns about them).
gen_out=$("$TS" generate --abi 15 2>&1) || { echo "$gen_out"; exit 1; }
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

# Rebuild the native Node addon after regeneration, then verify the public binding.
npm run test:node
npm run test:types

# Scanner invariants that only surface on a modern tree-sitter runtime (the
# rust dev-dependency tracks the CLI), so `tree-sitter test` cannot express
# them — a zero-width token is invisible to an older runtime.
if command -v cargo >/dev/null 2>&1; then
    cargo test --locked --quiet
else
    echo "SKIP: cargo not found, skipping runtime invariant tests"
fi

# `parse -q` reports parse errors on stdout, but loader/compiler failures can
# report only on stderr. Preserve diagnostics and check both status and output.
sweep=(tests/*.move)
if [ ${#sweep[@]} -eq 0 ]; then
    echo "FAILED: no local Move fixtures found" >&2
    exit 1
fi
if [ -d "$SUI_FRAMEWORK_ROOT" ]; then
    for package in sui-framework move-stdlib; do
        framework_files=("$SUI_FRAMEWORK_ROOT"/"$package"/**/*.move)
        if [ ${#framework_files[@]} -eq 0 ]; then
            echo "FAILED: no Move files found in $SUI_FRAMEWORK_ROOT/$package" >&2
            exit 1
        fi
        sweep+=("${framework_files[@]}")
    done
    # Include other checked-out framework packages (for example sui-system,
    # bridge and deepbook) without requiring them in a partial checkout.
    for package_dir in "$SUI_FRAMEWORK_ROOT"/*/; do
        case "${package_dir%/}" in
            */sui-framework|*/move-stdlib) continue ;;
        esac
        sweep+=("$package_dir"**/*.move)
    done
fi
if failures=$("$TS" parse -q "${sweep[@]}"); then
    :
else
    printf '%s\n' "$failures"
    echo "FAILED: parse sweep failed" >&2
    exit 1
fi
if [ -n "$failures" ]; then
    echo "$failures"
    echo "FAILED: some files did not parse cleanly"
    exit 1
fi
echo "OK: all ${#sweep[@]} files parsed cleanly"
