//! This crate provides Move language support for the [tree-sitter] parsing
//! library.
//!
//! [tree-sitter]: https://tree-sitter.github.io/

use tree_sitter_language::LanguageFn;

extern "C" {
    fn tree_sitter_move() -> *const ();
}

/// The tree-sitter [`LanguageFn`] for this grammar.
pub const LANGUAGE: LanguageFn = unsafe { LanguageFn::from_raw(tree_sitter_move) };

/// The content of the [`node-types.json`][] file for this grammar.
///
/// [`node-types.json`]: https://tree-sitter.github.io/tree-sitter/using-parsers/6-static-node-types
pub const NODE_TYPES: &str = include_str!("../../src/node-types.json");

/// The syntax highlighting query for this grammar.
pub const HIGHLIGHTS_QUERY: &str = include_str!("../../queries/highlights.scm");

/// The local-variable syntax query for this grammar.
pub const LOCALS_QUERY: &str = include_str!("../../queries/locals.scm");

/// The injections query for this grammar.
pub const INJECTIONS_QUERY: &str = include_str!("../../queries/injections.scm");

/// The symbol tagging query for this grammar.
pub const TAGS_QUERY: &str = include_str!("../../queries/tags.scm");

#[cfg(test)]
mod tests {
    fn parser() -> tree_sitter::Parser {
        let mut parser = tree_sitter::Parser::new();
        parser.set_language(&super::LANGUAGE.into()).unwrap();
        parser
    }

    fn point_at(source: &str, byte: usize) -> tree_sitter::Point {
        let prefix = &source.as_bytes()[..byte];
        tree_sitter::Point {
            row: prefix.iter().filter(|&&byte| byte == b'\n').count(),
            column: prefix
                .iter()
                .rposition(|&byte| byte == b'\n')
                .map_or(byte, |newline| byte - newline - 1),
        }
    }

    // Comparing only the S-expression misses stale token boundaries and ranges
    // after incremental edits. Include every anonymous token and its positions.
    fn snapshot(tree: &tree_sitter::Tree) -> Vec<(String, tree_sitter::Range, bool, bool, bool)> {
        let mut result = Vec::new();
        let mut cursor = tree.walk();
        loop {
            let node = cursor.node();
            result.push((
                node.kind().into(),
                node.range(),
                node.is_named(),
                node.is_extra(),
                node.is_missing(),
            ));
            if cursor.goto_first_child() {
                continue;
            }
            while !cursor.goto_next_sibling() {
                if !cursor.goto_parent() {
                    return result;
                }
            }
        }
    }

    fn assert_incremental_edit(source: &str, start: usize, end: usize, replacement: &str) {
        let mut parser = parser();
        let mut old_tree = parser.parse(source, None).unwrap();
        let edited = format!("{}{}{}", &source[..start], replacement, &source[end..]);
        old_tree.edit(&tree_sitter::InputEdit {
            start_byte: start,
            old_end_byte: end,
            new_end_byte: start + replacement.len(),
            start_position: point_at(source, start),
            old_end_position: point_at(source, end),
            new_end_position: point_at(&edited, start + replacement.len()),
        });
        let incremental = parser.parse(&edited, Some(&old_tree)).unwrap();
        let fresh = self::parser().parse(&edited, None).unwrap();
        assert_eq!(
            incremental.root_node().to_sexp(),
            fresh.root_node().to_sexp(),
            "edit {start}..{end} -> {replacement:?} in {source:?}"
        );
        assert_eq!(
            snapshot(&incremental),
            snapshot(&fresh),
            "edit {start}..{end} -> {replacement:?} in {source:?}"
        );
    }

    #[test]
    fn scanner_incremental_edits_match_fresh_parses() {
        // Include malformed intermediate states, because comments and vector
        // lookahead are frequently edited before a valid expression is complete.
        let sources = [
            "module a::b { fun f() { vector /* outer /* inner */ end */ [1]; } }",
            "module a::b { fun f() { vector // comment\n <u8>[1]; } }",
            "module a::b { fun f(vector: u64) { vector <= 3; vector << 2; } }",
            "module a::b;\n/// heading\n  /// body\n\n/// next\nfun f() {}\n///",
            "module a::b;\r\n/// café\r\n\t/// body\r\nfun f() {}",
            "module a::b { fun f() { h(a<b, c>(d)); h(a < b, c > (d)); } }",
            "module a::b { fun f() { x.method<T>(); x.method!<T>(); `if`<T>(); } }",
            "module a::b { fun f() { h(a/* gap */< b, c > (d)); } }",
        ];
        for source in sources {
            for start in 0..=source.len() {
                if !source.is_char_boundary(start) {
                    continue;
                }
                for inserted in ["/", "*", "\n", " ", "<", "=", "[", ">", "é"] {
                    assert_incremental_edit(source, start, start, inserted);
                }
                if let Some(next) = source[start..].chars().next() {
                    assert_incremental_edit(source, start, start + next.len_utf8(), "");
                }
            }
        }
    }

    #[test]
    fn chained_edits_match_fresh_parses() {
        // Keep reusing each edited tree, as an editor does over a sequence of
        // keystrokes. Restart periodically so malformed tails do not dominate.
        let sources = [
            "module a::b;\n/// café 🦀\n/// next\nfun f() { vector /*nested /* x */ */ [1]; }",
            "module a::b { fun f() { h(a < b, c > (d)); x.method<T>(); x.method!<T>(); } }",
            "module a::b { fun f() { let spec = 1; let S { x: bound, short } = value; } }",
        ];
        let replacements = [
            "", " ", "\n", "\r\n", "/*", "*/", "///", "<", ">", "!", "é", "🦀",
        ];
        let mut random = 0x1d52_5a71_c39b_602fu64;
        for original in sources {
            for _ in 0..8 {
                let mut parser = parser();
                let mut source = original.to_owned();
                let mut tree = parser.parse(&source, None).unwrap();
                for _ in 0..16 {
                    random = random.wrapping_mul(6364136223846793005).wrapping_add(1);
                    let boundaries: Vec<_> = source
                        .char_indices()
                        .map(|(i, _)| i)
                        .chain(std::iter::once(source.len()))
                        .collect();
                    let index = (random >> 32) as usize % boundaries.len();
                    let start = boundaries[index];
                    let end = boundaries[(index + (random as usize % 4)).min(boundaries.len() - 1)];
                    let replacement = replacements[(random >> 16) as usize % replacements.len()];
                    let edited = format!("{}{}{}", &source[..start], replacement, &source[end..]);
                    tree.edit(&tree_sitter::InputEdit {
                        start_byte: start,
                        old_end_byte: end,
                        new_end_byte: start + replacement.len(),
                        start_position: point_at(&source, start),
                        old_end_position: point_at(&source, end),
                        new_end_position: point_at(&edited, start + replacement.len()),
                    });
                    let incremental = parser.parse(&edited, Some(&tree)).unwrap();
                    let fresh = self::parser().parse(&edited, None).unwrap();
                    assert_eq!(
                        snapshot(&incremental),
                        snapshot(&fresh),
                        "seed {random}, edit {start}..{end} -> {replacement:?} in {source:?}"
                    );
                    source = edited;
                    tree = incremental;
                }
            }
        }
    }

    #[test]
    fn scanner_handles_utf16_in_both_byte_orders() {
        let source = "module a::b;\r\n/// café 🦀\r\n/// next\r\nfun f() { vector /* 🦀 /* nested */ */ <u8>[1]; call<T>(); obj.`while`<T>(); }";
        let expected = parser().parse(source, None).unwrap();
        assert!(!expected.root_node().has_error());
        let little: Vec<_> = source.encode_utf16().map(u16::to_le).collect();
        let big: Vec<_> = source.encode_utf16().map(u16::to_be).collect();
        for tree in [
            parser().parse_utf16_le(&little, None).unwrap(),
            parser().parse_utf16_be(&big, None).unwrap(),
        ] {
            assert_eq!(tree.root_node().to_sexp(), expected.root_node().to_sexp());
            assert_eq!(tree.root_node().end_byte(), little.len() * 2);
            for (kind, range, _, _, _) in snapshot(&tree) {
                assert_eq!(range.start_byte % 2, 0, "{kind}");
                assert_eq!(range.end_byte % 2, 0, "{kind}");
                if kind == "doc_comment" {
                    assert!(range.end_byte > range.start_byte);
                }
            }
        }
    }

    #[test]
    fn generic_identifier_scanning_preserves_keyword_and_length_rules() {
        // Unconditional keywords from the Move lexer, including the escaped
        // exception. The external generic-name token must not bypass them.
        let reserved = [
            "abort", "as", "break", "const", "continue", "copy", "else", "false", "fun", "friend",
            "if", "let", "loop", "module", "move", "native", "public", "return", "struct", "true",
            "use", "while",
        ];
        let mut parser = parser();
        for keyword in reserved {
            let source = format!("module a::b {{ fun f() {{ obj.{keyword}<u64>(); }} }}");
            assert!(
                parser.parse(&source, None).unwrap().root_node().has_error(),
                "{source}"
            );
            let escaped = format!("module a::b {{ fun f() {{ obj.`{keyword}`<u64>(); }} }}");
            assert!(
                !parser
                    .parse(&escaped, None)
                    .unwrap()
                    .root_node()
                    .has_error(),
                "{escaped}"
            );
        }
        for prefix in ["return", "vector"] {
            let name = format!("{prefix}{}", "_long_identifier".repeat(256));
            let source =
                format!("module a::b {{ fun f() {{ {name}<u64>(); obj.`{name}`<u64>(); }} }}");
            assert!(!parser.parse(&source, None).unwrap().root_node().has_error());
        }
    }

    #[test]
    fn scanner_respects_disjoint_included_ranges() {
        let first = "module a::b;\n/// café\nfun f() { vector /* nested /* x */ */ [1]; }\n";
        let second = "module a::c;\n/// 🦀\nfun g() { call<T>(); }\n";
        let source = format!("ignored /*\n{first}outside ///\n{second}trailer /*");
        let ranges: Vec<_> = [first, second]
            .iter()
            .map(|part| {
                let start = source.find(part).unwrap();
                let end = start + part.len();
                tree_sitter::Range {
                    start_byte: start,
                    end_byte: end,
                    start_point: point_at(&source, start),
                    end_point: point_at(&source, end),
                }
            })
            .collect();
        let mut parser = parser();
        parser.set_included_ranges(&ranges).unwrap();
        let included = parser.parse(&source, None).unwrap();
        let expected = self::parser()
            .parse(format!("{first}{second}"), None)
            .unwrap();
        assert!(!included.root_node().has_error());
        assert_eq!(
            included.root_node().to_sexp(),
            expected.root_node().to_sexp()
        );
        for module in included.root_node().named_children(&mut included.walk()) {
            assert!(ranges
                .iter()
                .any(|range| module.start_byte() >= range.start_byte
                    && module.end_byte() <= range.end_byte));
        }
    }

    #[test]
    fn doc_comments_at_included_range_end_are_nonempty() {
        for included in ["///", "/// x\n///", "/// x", "///\n", "/// café\r\n\t///"] {
            let source = format!("before\n```move\n{included}\n```\nafter");
            let start = source.find(included).unwrap();
            let end = start + included.len();
            let mut parser = parser();
            parser
                .set_included_ranges(&[tree_sitter::Range {
                    start_byte: start,
                    end_byte: end,
                    start_point: point_at(&source, start),
                    end_point: point_at(&source, end),
                }])
                .unwrap();
            let tree = parser.parse(&source, None).unwrap();
            assert!(!tree.root_node().has_error(), "{included:?}");
            for (kind, range, _, _, _) in snapshot(&tree) {
                assert!(
                    range.start_byte >= start && range.end_byte <= end,
                    "{kind}: {range:?}"
                );
                if kind == "doc_comment" {
                    assert!(range.end_byte > range.start_byte, "{included:?}");
                }
            }
        }
    }

    #[test]
    fn deeply_nested_comments_and_long_doc_blocks_parse() {
        let nested = format!("{}nested{}", "/*".repeat(4096), "*/".repeat(4096));
        let source = format!("module a::b {{ fun f() {{ vector {nested} [1]; }} }}");
        let mut parser = parser();
        let tree = parser.parse(&source, None).unwrap();
        assert!(!tree.root_node().has_error());
        assert_eq!(
            snapshot(&tree)
                .iter()
                .filter(|node| node.0 == "block_comment")
                .count(),
            1
        );

        let source = format!("module a::b;\n{}fun f() {{}}", "/// body\n".repeat(4096));
        let tree = parser.parse(&source, None).unwrap();
        assert!(!tree.root_node().has_error());
        assert_eq!(
            snapshot(&tree)
                .iter()
                .filter(|node| node.0 == "doc_comment")
                .count(),
            4096
        );
        assert_eq!(
            snapshot(&tree)
                .iter()
                .filter(|node| node.0 == "line_comment")
                .count(),
            1
        );
    }

    #[test]
    fn test_can_load_grammar() {
        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(&super::LANGUAGE.into())
            .expect("Error loading Move parser");
        let tree = parser
            .parse("module a::b { fun f() { let v = vector[1, 2]; } }", None)
            .expect("Error parsing Move source");
        assert!(!tree.root_node().has_error());
    }

    /// A `doc_comment` must never be zero-width. `queries/injections.scm`
    /// turns them into the included ranges of a markdown injection, and an
    /// empty range set means "no included ranges" — which tree-sitter reads
    /// as the whole document, so markdown would be parsed over the Move code.
    ///
    /// A `///` marker with nothing after it produces one: end of input is
    /// reachable at the end of an *injected* region (a ```move fence inside a
    /// doc comment), and for other consumers at genuine EOF. The scanner
    /// refuses to open a doc block there, leaving a plain `line_comment`.
    ///
    /// Note this cannot be expressed as a `test/corpus` case: the zero-width
    /// token only surfaces on a modern tree-sitter runtime, and `tree-sitter
    /// test` uses whichever CLI is installed.
    #[test]
    fn doc_comment_is_never_zero_width() {
        let mut parser = tree_sitter::Parser::new();
        parser.set_language(&super::LANGUAGE.into()).unwrap();

        let mut widths = |src: &str| {
            let tree = parser.parse(src, None).expect("Error parsing Move source");
            let mut widths = Vec::new();
            let mut stack = vec![tree.root_node()];
            while let Some(node) = stack.pop() {
                if node.kind() == "doc_comment" {
                    widths.push(node.end_byte() - node.start_byte());
                }
                for i in 0..node.child_count() as u32 {
                    stack.push(node.child(i).unwrap());
                }
            }
            widths
        };

        // `///` at end of input: no doc block at all.
        assert_eq!(widths("module a::b;\n///"), Vec::<usize>::new());
        // same, reached through the block-continuation path.
        assert_eq!(widths("module a::b;\n/// a\n///"), vec![3]);
        // ordinary doc lines are unaffected, newline included (69bcff3).
        assert_eq!(widths("module a::b;\n/// x"), vec![2]);
        assert_eq!(widths("module a::b;\n///\n"), vec![1]);
    }
}
