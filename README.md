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

## Tests

`./run-tests.sh` runs, in order: `tree-sitter generate`, the tree-shape corpus
in `test/corpus/` (`tree-sitter test`), the highlight assertions in
`test/highlights/` (`python3 test/highlights/check.py` — same comment syntax as
tree-sitter's highlight tests, but with nvim's capture-resolution semantics and
no need for a global CLI config), and finally a parse sweep over `tests/*.move`
plus the sui-framework and move-stdlib sources.

Note: there is deliberately no `tree-sitter.json`, which keeps `tree-sitter
generate` on ABI 14 — the prettier-move plugin loads this grammar through
`web-tree-sitter` 0.20.x, which cannot load ABI 15 parsers. Add the file (and
regenerate the wasm) only after upgrading that dependency.

## Running Examples

This requires you installing the tree-sitter CLI

```
cargo install tree-sitter-cli
```

You can then run the tests with

```sh
./run-tests.sh
```

Alternatively, to run a single test

```sh
tree-sitter parse -q -t path/to/file.move
```

An example of what the output CST would look like would be the following (NB: this is using tree sitter to highlight the Move code as well).

![Screenshot](./tree_sitter.png)
