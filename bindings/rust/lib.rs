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
