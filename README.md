# Tree Sitter for Move

This is a WIP implementation of tree sitter for Move.

## Current Status

It should be able to parse all valid Move code (although no guarantees are made at the moment on this).

More work should probably done in terms of laying out the CST better, although it's not the worst as it stands right now.

In addition to whole files, the grammar parses the signature fragments that
the move-analyzer LSP renders in hover tooltips (qualified function/struct/enum
signatures, `let x: T` locals, bare types, and so on), so ` ```move ` code
fences in hover markdown highlight correctly without a wrapping module.

## External Scanner

The grammar uses an external scanner (`src/scanner.c`) for:

- the contextual `vector` keyword that starts a vector literal (`vector[1, 2]`,
  `vector<u8>[]`, including the spaced forms `vector [1]` / `vector <u8> [1]`).
  Mirroring the Move compiler, `vector` only starts a literal when the next
  token is `[` or `<`; everywhere else it stays an ordinary identifier
  (`vector::empty()`, `use std::vector`).
- block comments, which nest in Move (`/* a /* b */ c */`) and therefore cannot
  be described by a regular-expression token.
- `///` doc comments, whose content is exposed as a `doc_comment` node for
  markdown injection (`////...` is a plain comment again, as in Rust).
- an error sentinel used to detect error-recovery states.

Any build of this parser must therefore compile **both** `src/parser.c` and
`src/scanner.c`. The tree-sitter CLI, `tree-sitter build --wasm`, and the
node-gyp binding pick the scanner up automatically. When building a shared
library by hand:

```sh
cc -shared -fPIC -O2 -I src src/parser.c src/scanner.c -o parser.so
```

## The tree-sitter CLI

`src/parser.c`, `src/grammar.json`, `src/node-types.json` and
`src/tree_sitter/` are generated and **committed**, so the CLI version matters:
an older one silently rewrites all four in an older format (Debian's
`tree-sitter-cli` is still 0.20.8, and it drops `grammar.json`'s `$schema` and
`reserved` keys). Nothing here uses a bare `tree-sitter` off `PATH` — the
version is pinned in `package.json` and everything resolves
`node_modules/.bin/tree-sitter`:

```sh
npm install          # once; run-tests.sh does this for you if it is missing
npm run generate     # instead of a bare `tree-sitter generate`
```

`run-tests.sh` refuses to run if the resolved CLI is not the pinned major.minor,
and `test/highlights/check.py` resolves the same binary. On a clean tree a
regeneration is a no-op; if it moves anything under `src/`, commit that along
with the `grammar.js` change that caused it.

`generate` prints `No 'tree-sitter.json' file found ... Using ABI version 14
instead`. That is deliberate and load-bearing: the absence of the file is what
pins the output to ABI 14, and the prettier-move plugin loads this grammar
through `web-tree-sitter` 0.20.x, which cannot load ABI 15 parsers. Adding
`tree-sitter.json` switches generation to ABI 15 — do it (and regenerate the
wasm) only after upgrading that dependency.

Consumers embedding this grammar want a matching-generation runtime. Neovim and
the Rust dev-dependency are both on the tree-sitter 0.25+ line; some scanner
invariants (a zero-width token, for instance) are simply invisible to an older
runtime, which is why those are asserted from `cargo test` rather than
`test/corpus`.

## Tests

`./run-tests.sh` runs, in order: `tree-sitter generate`, the tree-shape corpus
in `test/corpus/` (`tree-sitter test`), the highlight assertions in
`test/highlights/` (`python3 test/highlights/check.py` — same comment syntax as
tree-sitter's highlight tests, but with nvim's capture-resolution semantics and
no need for a global CLI config), the Rust runtime invariants (`cargo test`,
skipped if cargo is absent), and finally a parse sweep over `tests/*.move` plus
the sui-framework and move-stdlib sources.

## Running Examples

```sh
npm install
./run-tests.sh
```

Alternatively, to run a single test

```sh
npx tree-sitter parse -q -t path/to/file.move
```

An example of what the output CST would look like would be the following (NB: this is using tree sitter to highlight the Move code as well).

![Screenshot](./tree_sitter.png)
