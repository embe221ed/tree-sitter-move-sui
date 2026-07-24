// Copyright (c) The Move Contributors
// SPDX-License-Identifier: Apache-2.0

// External scanner for the Move tree-sitter grammar. It recognizes:
//
// - The contextual `vector` keyword that starts a vector literal. Mirroring
//   the Move compiler's parser (see `parse_term` in
//   move-compiler/src/parser/syntax.rs), the identifier `vector` begins a
//   vector literal if and only if the *next token* is `[` or `<` (i.e.
//   `vector[...]`, `vector<T>[...]`, including forms with whitespace or
//   comments such as `vector [1, 2]`). In every other position
//   (`vector::empty()`, `use std::vector`, ...) it is an ordinary identifier,
//   which the internal lexer handles.
//
// - Block comments, which nest in Move (`/* a /* b */ c */`) and therefore
//   cannot be a regex token.

#include "tree_sitter/parser.h"

enum TokenType {
  VECTOR_KEYWORD,
  BLOCK_COMMENT,
  DOC_LINE_MARKER,
  DOC_LINE_CONTENT,
  DOC_LINE_CONT_MARKER,
  DOC_BLOCK_END,
  ERROR_SENTINEL,
};

void *tree_sitter_move_external_scanner_create(void) { return NULL; }

void tree_sitter_move_external_scanner_destroy(void *payload) { (void)payload; }

unsigned tree_sitter_move_external_scanner_serialize(void *payload, char *buffer) {
  (void)payload;
  (void)buffer;
  return 0;
}

void tree_sitter_move_external_scanner_deserialize(void *payload, const char *buffer,
                                                   unsigned length) {
  (void)payload;
  (void)buffer;
  (void)length;
}

static inline bool is_ident_char(int32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
         c == '_';
}

static inline bool is_space(int32_t c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == 0x0b;
}

// Consumes a (possibly nested) block comment, assuming `/*` has already been
// consumed. Returns false on EOF inside the comment.
static bool consume_block_comment_body(TSLexer *lexer) {
  unsigned depth = 1;
  while (depth > 0) {
    if (lexer->eof(lexer)) {
      return false;
    }
    int32_t c = lexer->lookahead;
    lexer->advance(lexer, false);
    if (c == '*' && lexer->lookahead == '/') {
      lexer->advance(lexer, false);
      depth--;
    } else if (c == '/' && lexer->lookahead == '*') {
      lexer->advance(lexer, false);
      depth++;
    }
  }
  return true;
}

bool tree_sitter_move_external_scanner_scan(void *payload, TSLexer *lexer,
                                            const bool *valid_symbols) {
  (void)payload;

  // ERROR_SENTINEL is valid only during error recovery (when every symbol
  // is), so it discriminates recovery from the after-marker state below.
  bool in_error_recovery = valid_symbols[ERROR_SENTINEL];

  // The rest of a `///` doc line. May be empty (a bare `///` is a markdown
  // paragraph break); only the scanner can emit zero-width tokens, and it
  // runs before extras. The trailing newline is included in the token so
  // that markdown injection of the combined doc lines sees line boundaries
  // (otherwise a leading `#` heading would run on across every doc line).
  // Continuation of a doc block: the next line is also `///` with nothing
  // but blanks before it. A blank line or code line ends the block (and so
  // ends the markdown document injected into it). Runs before extras, so
  // the check sees the raw start of the next line.
  if (valid_symbols[DOC_LINE_CONT_MARKER] && !in_error_recovery) {
    // zero-width fallback: if the block does not continue, emit the
    // (required) end-of-block token at the current position
    lexer->mark_end(lexer);
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') {
      lexer->advance(lexer, false);
    }
    if (lexer->lookahead == '/') {
      lexer->advance(lexer, false);
      if (lexer->lookahead == '/') {
        lexer->advance(lexer, false);
        if (lexer->lookahead == '/') {
          lexer->advance(lexer, false);
          if (lexer->lookahead != '/') {
            lexer->mark_end(lexer);
            lexer->result_symbol = DOC_LINE_CONT_MARKER;
            return true;
          }
        }
      }
    }
    if (valid_symbols[DOC_BLOCK_END]) {
      lexer->result_symbol = DOC_BLOCK_END;
      return true;
    }
    return false;
  }

  if (valid_symbols[DOC_LINE_CONTENT] && !in_error_recovery) {
    while (lexer->lookahead != '\n' && !lexer->eof(lexer)) {
      lexer->advance(lexer, false);
    }
    if (lexer->lookahead == '\n') {
      lexer->advance(lexer, false);
    }
    lexer->mark_end(lexer);
    lexer->result_symbol = DOC_LINE_CONTENT;
    return true;
  }

  // Everything the scanner lexes after a `/` — block comments and the `///`
  // doc marker — shares one forward scan, since a rejected branch cannot
  // hand back consumed characters to another scanner branch.
  if ((valid_symbols[BLOCK_COMMENT] || valid_symbols[DOC_LINE_MARKER]) &&
      lexer->lookahead == '/') {
    lexer->advance(lexer, false);

    if (lexer->lookahead == '*' && valid_symbols[BLOCK_COMMENT]) {
      lexer->advance(lexer, false);
      if (!consume_block_comment_body(lexer)) {
        // Unterminated comment at EOF: emit it anyway so an in-progress
        // `/* ...` while typing degrades to a trailing comment instead of
        // the file tail being lexed as code inside an ERROR.
        lexer->mark_end(lexer);
      }
      lexer->result_symbol = BLOCK_COMMENT;
      return true;
    }

    // `///` opens a doc comment; `//` and `////...` stay plain comments
    // (Rust rule), handled by the internal line_comment token.
    if (lexer->lookahead == '/' && valid_symbols[DOC_LINE_MARKER]) {
      lexer->advance(lexer, false);
      if (lexer->lookahead != '/') {
        return false;
      }
      lexer->advance(lexer, false);
      if (lexer->lookahead == '/') {
        return false;
      }
      lexer->mark_end(lexer);
      lexer->result_symbol = DOC_LINE_MARKER;
      return true;
    }

    // `/` division: lexed internally.
    return false;
  }

  if (!valid_symbols[VECTOR_KEYWORD]) {
    return false;
  }

  // Leading whitespace/comments are left to the `extras` rules (the newline
  // tokens matter to consumers like prettier-move); the scanner is re-invoked
  // once they have been consumed.
  static const char word[] = "vector";
  for (const char *c = word; *c != '\0'; c++) {
    if (lexer->lookahead != *c) {
      return false;
    }
    lexer->advance(lexer, false);
  }

  // `vectorish`, `vector_foo`, etc. are ordinary identifiers.
  if (is_ident_char(lexer->lookahead)) {
    return false;
  }

  // The token is just the word `vector`; everything past this point is
  // lookahead used to decide whether to emit it.
  lexer->mark_end(lexer);

  // The compiler's lookahead works on tokens, so any mix of whitespace and
  // comments may sit between `vector` and the deciding `[`/`<`.
  for (;;) {
    if (is_space(lexer->lookahead)) {
      lexer->advance(lexer, false);
    } else if (lexer->lookahead == '/') {
      lexer->advance(lexer, false);
      if (lexer->lookahead == '/') {
        while (lexer->lookahead != '\n' && !lexer->eof(lexer)) {
          lexer->advance(lexer, false);
        }
      } else if (lexer->lookahead == '*') {
        lexer->advance(lexer, false);
        if (!consume_block_comment_body(lexer)) {
          return false;
        }
      } else {
        return false;
      }
    } else {
      break;
    }
  }

  if (lexer->lookahead == '[') {
    lexer->result_symbol = VECTOR_KEYWORD;
    return true;
  }

  if (lexer->lookahead == '<') {
    // `<=` and `<<` are single tokens in Move, so `vector <= x` / `vector << x`
    // would not start a literal (mirrors the compiler's `Tok::Less` lookahead).
    lexer->advance(lexer, false);
    if (lexer->lookahead == '=' || lexer->lookahead == '<') {
      return false;
    }
    lexer->result_symbol = VECTOR_KEYWORD;
    return true;
  }

  return false;
}
