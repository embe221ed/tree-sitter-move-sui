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
// - Names immediately followed by a single `<`, for expression type
//   arguments. This is stateless lookahead: whitespace and comments following
//   the name remain visible to their own tokens, and incremental parsing can
//   invalidate the name when the adjacency changes.
//
// - Block comments, which nest in Move (`/* a /* b */ c */`) and therefore
//   cannot be a regex token.

#include "tree_sitter/parser.h"
#include <string.h>

enum TokenType {
  VECTOR_KEYWORD,
  BLOCK_COMMENT,
  DOC_LINE_MARKER,
  DOC_LINE_CONTENT,
  DOC_LINE_CONT_MARKER,
  DOC_BLOCK_END,
  GENERIC_IDENTIFIER,
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

static inline bool is_ident_start(int32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_';
}

static inline bool is_ident_char(int32_t c) {
  return is_ident_start(c) || (c >= '0' && c <= '9');
}

// External tokens bypass Tree-sitter's internal reserved-word lexer. Keep
// this list aligned with grammar.js's global reserved set; escaped names
// are intentionally exempt.
static bool is_reserved_word(const char *name) {
  static const char *const words[] = {
    "abort", "as", "break", "const", "continue", "copy", "else", "false",
    "fun", "friend", "if", "let", "loop", "module", "move", "native",
    "public", "return", "struct", "true", "use", "while",
  };
  for (unsigned i = 0; i < sizeof(words) / sizeof(words[0]); i++) {
    if (strcmp(name, words[i]) == 0) return true;
  }
  return false;
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
          // A `///` with nothing after it — end of input, which for an
          // injected region means the end of that region — would leave
          // DOC_LINE_CONTENT below with nothing to consume, and a zero-width
          // `doc_comment` makes its markdown injection range empty. An empty
          // range set means "no included ranges", i.e. the whole buffer. End
          // the block instead; the `///` stays a plain line_comment.
          if (lexer->lookahead != '/' && !lexer->eof(lexer)) {
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
      // Same reason as the continuation marker above: don't open a doc block
      // whose content token would be zero-width.
      if (lexer->eof(lexer)) {
        return false;
      }
      lexer->mark_end(lexer);
      lexer->result_symbol = DOC_LINE_MARKER;
      return true;
    }

    // `/` division: lexed internally.
    return false;
  }

  if (!valid_symbols[VECTOR_KEYWORD] &&
      (!valid_symbols[GENERIC_IDENTIFIER] || in_error_recovery)) {
    return false;
  }

  // Do not skip extras here: their public ranges must remain intact.
  bool escaped = lexer->lookahead == '`';
  if (escaped) lexer->advance(lexer, false);
  if (!is_ident_start(lexer->lookahead)) {
    return false;
  }
  // Only short contextual/reserved words need their spelling retained. A
  // longer identifier is still consumed fully and can never equal one of them.
  char name[16] = {0};
  unsigned length = 0;
  while (is_ident_char(lexer->lookahead)) {
    if (length < sizeof(name) - 1) name[length++] = (char)lexer->lookahead;
    lexer->advance(lexer, false);
  }
  if (escaped) {
    if (lexer->lookahead != '`') return false;
    lexer->advance(lexer, false);
  }
  lexer->mark_end(lexer);
  bool vector = !escaped && strcmp(name, "vector") == 0;
  if (!vector || !valid_symbols[VECTOR_KEYWORD]) {
    if (!valid_symbols[GENERIC_IDENTIFIER] || in_error_recovery || lexer->lookahead != '<') {
      return false;
    }
    if (!escaped && is_reserved_word(name)) return false;
    // `<=` and `<<` are complete operators, not generic argument openers.
    lexer->advance(lexer, false);
    if (lexer->lookahead == '=' || lexer->lookahead == '<') return false;
    lexer->result_symbol = GENERIC_IDENTIFIER;
    return true;
  }

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
