use std::collections::BTreeSet;
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};

#[test]
fn every_editor_query_compiles() {
    let language = tree_sitter_move::LANGUAGE.into();
    let queries = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("queries");
    for entry in std::fs::read_dir(queries).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|s| s.to_str()) == Some("scm") {
            let source = std::fs::read_to_string(&path).unwrap();
            Query::new(&language, &source)
                .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        }
    }
}

#[test]
fn tags_cover_definitions_and_calls() {
    let source = r#"
address 0x42 {
    module legacy {
        native struct Native;
        public struct Record { value: u64 }
        public enum Choice { One, Two }
        const LIMIT: u64 = 1;
        native fun external();
        macro fun repeat($x: u64): u64 { $x }
        fun run(record: Record) {
            external();
            helpers::call();
            record.method();
            repeat!(1);
            record.apply!();
        }
    }
}
module named::modern;
"#;
    let language = tree_sitter_move::LANGUAGE.into();
    let mut parser = Parser::new();
    parser.set_language(&language).unwrap();
    let tree = parser.parse(source, None).unwrap();
    assert!(
        !tree.root_node().has_error(),
        "{}",
        tree.root_node().to_sexp()
    );
    let query = Query::new(&language, tree_sitter_move::TAGS_QUERY).unwrap();
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&query, tree.root_node(), source.as_bytes());
    let mut symbols = BTreeSet::new();
    while let Some(m) = matches.next() {
        let name = m
            .captures()
            .iter()
            .find(|c| query.capture_names()[c.index as usize] == "name")
            .expect("tag matches must have a name");
        let kind = m
            .captures()
            .iter()
            .map(|c| query.capture_names()[c.index as usize])
            .find(|name| name.starts_with("definition.") || name.starts_with("reference."))
            .expect("tag matches must have a kind");
        symbols.insert((kind, name.node.utf8_text(source.as_bytes()).unwrap()));
    }
    let expected = BTreeSet::from([
        ("definition.module", "legacy"),
        ("definition.module", "named::modern"),
        ("definition.class", "Native"),
        ("definition.class", "Record"),
        ("definition.class", "Choice"),
        ("definition.constant", "LIMIT"),
        ("definition.function", "external"),
        ("definition.function", "repeat"),
        ("definition.function", "run"),
        ("reference.call", "external"),
        ("reference.call", "call"),
        ("reference.call", "method"),
        ("reference.call", "repeat"),
        ("reference.call", "apply"),
    ]);
    assert_eq!(symbols, expected);
}
