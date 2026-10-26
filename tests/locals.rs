use std::collections::BTreeSet;
use tree_sitter::{Parser, Query, QueryCursor, StreamingIterator};
use tree_sitter_highlight::{HighlightConfiguration, HighlightEvent, Highlighter};

fn local_highlights(source: &str) -> Vec<Option<&'static str>> {
    // Deliberately give definitions distinct colors from unresolved references.
    // The standard highlighter must propagate them through LOCALS_QUERY; merely
    // checking capture presence would miss incompatible capture names and scope
    // resolution errors.
    let names = [
        "unresolved",
        "parameter",
        "variable",
        "lambda",
        "pattern",
        "macro",
        "type",
    ];
    let query = r#"
        (identifier) @unresolved
        (function_parameter name: (variable_identifier) @parameter)
        (bind_var (variable_identifier) @variable)
        (lambda_binding bind: (bind_var (variable_identifier) @lambda))
        (at_bind (variable_identifier) @pattern)
        (function_parameter "$" name: (variable_identifier) @macro)
        (type_parameter (type_parameter_identifier) @type)
    "#;
    let mut config = HighlightConfiguration::new(
        tree_sitter_move::LANGUAGE.into(),
        "move",
        query,
        "",
        tree_sitter_move::LOCALS_QUERY,
    )
    .unwrap();
    config.configure(&names);
    let mut highlighter = Highlighter::new();
    let events = highlighter
        .highlight(&config, source.as_bytes(), None, None, |_| None)
        .unwrap();
    let mut active = Vec::new();
    let mut result = vec![None; source.len()];
    for event in events {
        match event.unwrap() {
            HighlightEvent::HighlightStart(highlight) => active.push(names[highlight.0]),
            HighlightEvent::HighlightEnd => {
                active.pop().unwrap();
            }
            HighlightEvent::Source { start, end } => {
                result[start..end].fill(active.last().copied());
            }
        }
    }
    result
}

fn assert_local_highlights(source: &str, expected: &[(&str, usize, &str)]) {
    // Validate the source tree too: highlighted recovery nodes could otherwise
    // make an invalid fixture appear to exercise successful local resolution.
    assert!(!captures(source, "local.scope").is_empty());
    let highlighted = local_highlights(source);
    for &(needle, offset, expected) in expected {
        let byte = source.find(needle).unwrap() + offset;
        assert_eq!(
            highlighted[byte],
            Some(expected),
            "{needle:?} at offset {offset}"
        );
    }
}

fn captures<'a>(source: &'a str, capture_name: &str) -> Vec<&'a str> {
    let language = tree_sitter_move::LANGUAGE.into();
    let mut parser = Parser::new();
    parser.set_language(&language).unwrap();
    let tree = parser.parse(source, None).unwrap();
    assert!(
        !tree.root_node().has_error(),
        "{}",
        tree.root_node().to_sexp()
    );
    let query = Query::new(&language, tree_sitter_move::LOCALS_QUERY).unwrap();
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&query, tree.root_node(), source.as_bytes());
    let mut captures = Vec::new();
    while let Some(matched) = matches.next() {
        for capture in matched.captures() {
            if query.capture_names()[capture.index as usize] == capture_name {
                captures.push(capture.node.utf8_text(source.as_bytes()).unwrap());
            }
        }
    }
    captures
}

#[test]
fn destructuring_captures_bindings_without_field_labels() {
    let source = r#"
module test::locals {
    fun f(input: S) {
        let simple = input;
        let mut mutable = input;
        let (first, mut second) = input;
        let S { label: renamed, shorthand, nested: T { inner: deep }, mut mutable_field } = input;
        let Pos(positional, mut mutable_positional) = input;
        let closure = |argument, mut mutable_argument| argument;
        match (input) {
            whole @ S { label: item, shorthand: short_item } => whole,
            (Choice::One(or_item) | Choice::Two(or_item)) => or_item,
            direct => direct,
        };
    }
}
"#;
    let actual: BTreeSet<_> = captures(source, "local.definition.var")
        .into_iter()
        .collect();
    let expected = BTreeSet::from([
        "simple",
        "mutable",
        "first",
        "second",
        "renamed",
        "shorthand",
        "deep",
        "mutable_field",
        "positional",
        "mutable_positional",
        "closure",
        "argument",
        "mutable_argument",
        "whole",
        "item",
        "short_item",
        "or_item",
        "direct",
    ]);
    assert_eq!(actual, expected);
}

#[test]
fn qualified_members_do_not_resolve_as_local_references() {
    let source = r#"
module test::locals {
    fun f(value: u64) {
        value;
        other::value();
        value::call();
        ::other::value();
        std::option::Option<u64>;
    }
}
"#;
    assert_eq!(captures(source, "local.reference"), vec!["value"]);
}

#[test]
fn aliased_import_defines_only_the_alias() {
    let source = r#"
module test::locals {
    use std::option::{Option as Maybe, none};
    use std::vector as vectors;
}
"#;
    assert_eq!(
        captures(source, "local.definition.import"),
        vec!["Maybe", "none", "vectors"]
    );
}

#[test]
fn declaration_parameters_belong_to_their_own_scopes() {
    let source = r#"
module test::locals {
    struct S<StructT> { value: StructT }
    enum E<EnumT> { Item(EnumT) }
    native struct Native<NativeT>;
    native fun external<FunctionT>(external_arg: FunctionT): FunctionT;
    native macro fun expand<MacroT>(macro_arg: MacroT): MacroT;
    spec fun usual<UsualT>(usual_arg: UsualT): UsualT { usual_arg }
    spec native fun native_spec<SpecT>(spec_arg: SpecT): SpecT;
    spec fun uninterpreted<UninterpretedT>(uninterpreted_arg: UninterpretedT): UninterpretedT;
    spec schema Schema<SchemaT> { value: SchemaT; }
    fun unrelated() {}
}
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
    let query = Query::new(&language, tree_sitter_move::LOCALS_QUERY).unwrap();
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&query, tree.root_node(), source.as_bytes());
    let mut scopes = Vec::new();
    let mut definitions = Vec::new();
    while let Some(matched) = matches.next() {
        for capture in matched.captures() {
            match query.capture_names()[capture.index as usize] {
                "local.scope" => scopes.push(capture.node),
                "local.definition.type" | "local.definition.parameter" => {
                    definitions.push(capture.node)
                }
                _ => {}
            }
        }
    }
    let actual: BTreeSet<_> = definitions
        .into_iter()
        .map(|definition| {
            // Model lexical lookup by assigning each definition to its narrowest
            // enclosing captured scope. A missing declaration scope would assign
            // these names to module_body or source_file, leaking them to siblings.
            let scope = scopes
                .iter()
                .filter(|scope| {
                    scope.start_byte() <= definition.start_byte()
                        && scope.end_byte() >= definition.end_byte()
                })
                .min_by_key(|scope| scope.end_byte() - scope.start_byte())
                .unwrap();
            (
                definition.utf8_text(source.as_bytes()).unwrap(),
                scope.kind(),
            )
        })
        .collect();
    let expected = BTreeSet::from([
        ("StructT", "struct_definition"),
        ("EnumT", "enum_definition"),
        ("NativeT", "native_struct_definition"),
        ("FunctionT", "native_function_definition"),
        ("external_arg", "native_function_definition"),
        ("MacroT", "native_macro_function_definition"),
        ("macro_arg", "native_macro_function_definition"),
        ("UsualT", "usual_spec_function"),
        ("usual_arg", "usual_spec_function"),
        ("SpecT", "native_spec_function"),
        ("spec_arg", "native_spec_function"),
        ("UninterpretedT", "uninterpreted_spec_function"),
        ("uninterpreted_arg", "uninterpreted_spec_function"),
        ("SchemaT", "spec_block"),
    ]);
    assert_eq!(actual, expected);
}

#[test]
fn standard_highlighter_resolves_shadowing_patterns_lambdas_and_macros() {
    let source = r#"
module test::locals {
    macro fun identity($input: u64): u64 { $input }
    fun run(value: u64, item: S) {
        value;
        { let value = 1; value + 2 };
        value + 3;
        let closure = |value| value + 4;
        value + 5;
        match (item) { whole @ S { field: value } if (value > 0) => { whole; value + 6 } };
        value + 7;
    }
}
"#;
    assert_local_highlights(
        source,
        &[
            ("{ $input }", 3, "macro"),
            ("value;", 0, "parameter"),
            ("value + 2", 0, "variable"),
            ("value + 3", 0, "parameter"),
            ("value + 4", 0, "lambda"),
            ("value + 5", 0, "parameter"),
            ("whole;", 0, "pattern"),
            ("value > 0", 0, "variable"),
            ("value + 6", 0, "variable"),
            ("value + 7", 0, "parameter"),
        ],
    );
}

#[test]
fn dotted_members_are_not_local_references_but_receivers_are() {
    let source = r#"
module test::locals {
    fun run<T>(record: S<T>, value: u64) {
        record.value;
        record.value();
        record.value!();
        record.value<T>();
        record.value!<T>();
        value;
    }
}
"#;
    assert_eq!(
        captures(source, "local.reference"),
        vec!["S", "T", "record", "record", "record", "record", "T", "record", "T", "value"]
    );
    assert_local_highlights(
        source,
        &[
            ("record.value;", 0, "parameter"),
            ("record.value;", 7, "unresolved"),
            ("record.value();", 7, "unresolved"),
            ("record.value!();", 7, "unresolved"),
            ("record.value<T>();", 7, "unresolved"),
            ("record.value<T>();", 13, "type"),
            ("record.value!<T>();", 7, "unresolved"),
            ("record.value!<T>();", 14, "type"),
            ("        value;", 8, "parameter"),
        ],
    );
}

#[test]
fn contextual_identifiers_are_definitions_in_binding_positions() {
    let source = r#"
module test::locals {
    fun run(input: u64) {
        let spec = input;
        let forall = input;
        let exists = input;
        let vector = input;
        let entry = input;
        spec + forall + exists + vector + entry;
        let closure = |spec| spec + 1;
        match (input) { exists => exists + 2 };
    }
}
"#;
    assert_eq!(
        captures(source, "local.definition.var"),
        vec!["spec", "forall", "exists", "vector", "entry", "closure", "spec", "exists"]
    );
    assert_local_highlights(
        source,
        &[
            ("spec + forall", 0, "variable"),
            ("forall + exists", 0, "variable"),
            ("exists + vector", 0, "variable"),
            ("vector + entry", 0, "variable"),
            ("entry;", 0, "variable"),
            ("spec + 1", 0, "lambda"),
            ("exists + 2", 0, "variable"),
        ],
    );
}

#[test]
fn named_addresses_do_not_resolve_against_same_named_locals() {
    let source = "module test::locals { fun run(std: u64) { std; @std } }";
    assert_eq!(captures(source, "local.reference"), vec!["std"]);
    assert_local_highlights(
        source,
        &[("std;", 0, "parameter"), ("@std", 1, "unresolved")],
    );
}

#[test]
fn contextual_member_metadata_preserves_the_member_field() {
    let source = "module t::m { fun f(x: T) { x.field; x.method<T>(); x.method!<T>(); @named; } }";
    let language = tree_sitter_move::LANGUAGE.into();
    let mut parser = Parser::new();
    parser.set_language(&language).unwrap();
    let tree = parser.parse(source, None).unwrap();
    assert!(
        !tree.root_node().has_error(),
        "{}",
        tree.root_node().to_sexp()
    );
    let mut stack = vec![tree.root_node()];
    let mut properties = 0;
    let mut addresses = 0;
    while let Some(node) = stack.pop() {
        for (field, count) in [("property", &mut properties), ("address", &mut addresses)] {
            if node.kind() == "module_access" {
                if let Some(contextual_member) = node.child_by_field_name(field) {
                    assert_eq!(
                        node.child_by_field_name("member"),
                        Some(contextual_member),
                        "{field} metadata must preserve the existing member field"
                    );
                    *count += 1;
                }
            }
        }
        let mut cursor = node.walk();
        stack.extend(node.children(&mut cursor));
    }
    assert_eq!(properties, 3);
    assert_eq!(addresses, 1);
}
