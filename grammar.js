// Copyright (c) The Move Contributors
// SPDX-License-Identifier: Apache-2.0

// Binary levels mirror move-compiler's parse_binop_exp precedence table
// (syntax.rs): notably `as` sits between the comparisons and `..`.
const PRECEDENCE = {
  assign: 1,
  implies: 2, // ==>
  or: 3, // ||
  and: 4, // &&
  eq: 5, // ==
  neq: 5, // !=
  lt: 5, // <
  gt: 5, // >
  le: 5, // <=
  ge: 5, // >=
  as: 6,
  range: 7, // ..
  bitor: 8, // |
  xor: 9, // ^
  bitand: 10, // &
  shl: 11, // <<
  shr: 11, // >>
  add: 12, // +
  sub: 12, // -
  mul: 13, // *
  div: 13, // /
  mod: 13, // %,
  unary: 14,
  // control expressions whose tail is a braced block terminate before any
  // binary operator: `if (c) 1 else { e } + 1` is `(if (c) 1 else { e }) + 1`
  block_tail: 14,
  field: 15,
  call: 16,
  apply_type: 16,
}

module.exports = grammar({
  name: 'move',
  extras: $ => [$._whitespace, $.line_comment, $.block_comment, $.newline, $.annotation],
  word: $ => $.identifier,
  // External tokens (src/scanner.c):
  // - _vector_keyword: the contextual `vector` keyword, produced only when the
  //   identifier `vector` is followed by `[` or `<` (mirroring the Move
  //   compiler's lookahead). Everywhere else `vector` lexes as a plain
  //   identifier (e.g. `vector::empty()`). It must be a named external (not
  //   the string 'vector') so keyword extraction via the `word` rule cannot
  //   lex it internally and bypass the scanner's lookahead.
  // - block_comment: lexed externally because Move block comments nest
  //   (`/* a /* b */ c */`), which a regex token cannot express.
  // - _doc_line_marker / _doc_line_content: `///` doc comments. The content
  //   may be empty (a bare `///` is a paragraph break) and zero-width tokens
  //   can only come from the scanner; the scanner also runs before extras,
  //   which keeps the newline from being consumed into the comment.
  // - _error_sentinel is never produced; it is only valid during error
  //   recovery, letting the scanner detect recovery states.
  externals: $ => [
    $._vector_keyword,
    $.block_comment,
    $._doc_line_marker,
    $._doc_line_content,
    $._doc_line_cont_marker,
    $._doc_block_end,
    $._error_sentinel,
  ],
  supertypes: $ => [
    $._spec_block_target,
    $._expression,
    $._type,
    $._bind,
    $._literal_value,
  ],
  // Every entry is load-bearing (run-tests.sh fails the build if `generate`
  // reports one as unnecessary). Entries marked [hover] exist only to support
  // the top-level hover-snippet items.
  conflicts: $ => [
    // annotation values vs expressions share module_access
    [$.annotation_expr, $.module_access],
    // binary/cast reshaping across the expression hierarchy
    [$._expression, $._expression_term],
    // `|...|` closes or reopens a function type
    [$.function_type_parameters],
    // a lone identifier: path segment vs variable vs module name
    [$.module_access, $._variable_identifier],
    [$.module_access, $._module_identifier],
    // `native` opens either a modifier chain or a native struct
    [$.modifier, $.native_struct_definition],
    // `'label:` vs `break 'label`
    [$.break_expression, $.block_identifier],
    // `mut x` as its own bind vs part of a larger one
    [$.mut_bind_var, $._bind],
    // 2-part vs 3-part path prefixes fork here
    [$.module_access],
    // `break`/`abort` with or without a trailing expression
    [$.break_expression],
    [$.abort_expression],
    // `spec` as block opener vs reserved identifier
    [$.spec_block, $._reserved_identifier],
    // [hover] `address` opens a block or is a bare primitive type snippet
    [$.address_block, $.primitive_type],
    // [hover] call args vs a finished term followed by a tuple-type snippet
    [$.call_expression, $._expression_term],
    [$.call_expression, $._dot_access_term],
    // [hover] `forall`/`exists` quantifier vs reserved name before `x: T`
    [$.quantifier_expression, $._reserved_identifier],
    // [hover] qualified-name prefixes vs module identities and access chains
    [$._hover_path_segment, $._module_identifier],
    [$._hover_path_segment, $.module_access],
    // patterns: or-list operands vs parenthesized groups
    [$.bind_list, $._or_bind],
    [$.comma_bind_list, $.paren_bind],
  ],

  rules: {
    // A file is either a sequence of modules or a hover fragment — never a
    // mix. Keeping the snippet items out of module files means an early `}`
    // during editing produces a contained ERROR instead of silently
    // re-parsing the rest of the file as signature-only hover nodes.
    source_file: $ => optional(choice(
      repeat1(choice(
        $.module_extension_definition,
        $.module_definition,
        $.address_block,
      )),
      repeat1($._snippet_item),
    )),

    // Legacy address blocks: `address 0x42 { module m { ... } }`. Still parsed
    // by the Move compiler, so accept them for editor robustness.
    address_block: $ => seq(
      'address',
      field('address', choice($.num_literal, $._module_identifier)),
      '{',
      repeat(choice($.module_definition, $.module_extension_definition)),
      '}',
    ),

    // Code fragments as emitted by the move-analyzer hover provider (DefInfo's
    // Display impl). Supporting them at the top level lets a ```move fence in
    // hover/documentation markdown parse and highlight cleanly without being
    // wrapped in a module.
    //
    // MEASURED COST (backlog C9): this layer accounts for roughly a quarter of
    // all parser states and a third of parser.c, plus the conflicts marked
    // [hover] above. If that ever becomes a problem, the intended path is a
    // define-grammar(options) factory building a snippet-free parser for
    // prettier-move's wasm and the full one for editors — not deleting the
    // layer.
    _snippet_item: $ => choice(
      $.hover_function,
      $.hover_struct,
      $.hover_enum,
      $.hover_variant,
      $.hover_const,
      $.hover_local,
      $.hover_module,
      $._type,
    ),

    // Qualified-name prefix like `sui::coin::` or `0x2::coin::` used by hover
    // signatures, which always render fully-qualified member names.
    _hover_path_segment: $ => seq(
      field('path', choice($.num_literal, alias($.identifier, $.module_identifier))),
      '::',
    ),

    hover_function: $ => seq(
      optional($.modifier),
      optional($.modifier),
      optional('macro'),
      'fun',
      repeat($._hover_path_segment),
      field('name', $._function_identifier),
      optional(field('type_parameters', $.type_parameters)),
      field('parameters', $.function_parameters),
      optional(field('return_type', $.ret_type)),
    ),

    hover_struct: $ => seq(
      optional($.modifier),
      'struct',
      repeat($._hover_path_segment),
      field('name', $._struct_identifier),
      optional(field('type_parameters', $.type_parameters)),
      optional(field('ability_declarations', $.ability_decls)),
      field('struct_fields', $.datatype_fields),
    ),

    hover_enum: $ => seq(
      optional($.modifier),
      'enum',
      repeat($._hover_path_segment),
      field('name', $._enum_identifier),
      optional(field('type_parameters', $.type_parameters)),
      optional(field('ability_declarations', $.ability_decls)),
      field('enum_variants', $.enum_variants),
    ),

    // `pkg::mod::Enum::Variant(u64)` / `pkg::mod::Enum::Variant{ x: u64 }`.
    // Builds its own path (rather than reusing module_access) so the parser
    // can fork between this and a bare type followed by a tuple type; the
    // dynamic precedence then prefers the variant reading.
    hover_variant: $ => prec.dynamic(1, seq(
      repeat1($._hover_path_segment),
      field('variant', alias($.identifier, $.variant_identifier)),
      field('fields', $.datatype_fields),
    )),

    hover_const: $ => seq(
      'const',
      repeat($._hover_path_segment),
      field('name', alias($.identifier, $.constant_identifier)),
      ':',
      field('type', $._type),
      optional(seq('=', field('expr', choice($._expression, $.literal_list)))),
      optional(';'),
    ),

    // Constant values of vector type render as `[1, 2, 3]` (nested for
    // multi-dimensional vectors) in hover.
    literal_list: $ => seq('[', sepBy(',', choice($._expression, $.literal_list)), ']'),

    hover_local: $ => choice(
      seq('let', optional('mut'), field('name', $._variable_identifier), ':', field('type', $._type)),
      seq('mut', field('name', $._variable_identifier), ':', field('type', $._type)),
      seq(field('name', $._variable_identifier), ':', field('type', $._type)),
      // positional field hover: `0: u64`
      seq(field('name', $.num_literal), ':', field('type', $._type)),
    ),

    hover_module: $ => seq('module', $.module_identity),

    // parse use declarations
    use_declaration: $ => seq(
      optional('public'),
      'use', choice($.use_fun, $.use_module, $.use_module_member, $.use_module_members), ';'),
    use_fun: $ => seq(
      'fun',
      $.module_access,
      'as',
      field('alias', seq($.module_access, '.', $._function_identifier))
    ),
    use_module: $ => seq($.module_identity, optional(seq('as', field('alias', $._module_identifier)))),
    use_module_member: $ => seq($.module_identity, '::', field('use_member', $.use_member)),
    use_module_members: $ => choice(
      seq(field('address', choice($.num_literal, $._module_identifier)), '::', '{', sepBy1(',', field('use_member', $.use_member)), '}'),
      seq($.module_identity, '::', '{', sepBy1(',', field('use_member', $.use_member)), '}'),
    ),
    use_member: $ => choice(
      seq(
        field('module', $.identifier),
        '::',
        '{',
        sepBy1(',', field('use_member', $.use_member)),
        '}'
      ),
      seq(field('module', $.identifier), '::', field('member', $.identifier), optional(seq('as', field('alias', $.identifier)))),
      seq(
        field('member', $.identifier),
        optional(seq('as', field('alias', $.identifier)))
      ),
    ),

    // parse top-level decl modifiers
    friend_declaration: $ => seq('friend', field('module', $.friend_access), ';'),
    modifier: $ => choice(
      seq(
        'public',
        optional(seq(
          '(',
          choice(
            'package',
            'friend',
          ),
          ')',
        ))),
      'entry',
      'native',
    ),
    ability: $ => choice(
      'copy',
      'drop',
      'store',
      'key',
    ),

    module_extension_definition: $ => {
      return seq(
        'extend',
        field('module', $.module_definition),
      );
    },

    module_definition: $ => {
      return seq(
        'module',
        // The bare-identifier form covers legacy modules inside `address` blocks.
        field('module_identity', choice($.module_identity, $._module_identifier)),
        field('module_body', $.module_body),
      );
    },
    module_body: $ => {
      const item = choice(
        $.use_declaration,
        $.friend_declaration,
        $.constant,
        $._function_item,
        $._struct_item,
        $._enum_item,
        $.spec_block,
      );
      // prec.right so that after `module a::b;` subsequent items are consumed
      // into the module body rather than parsed as top-level snippet items.
      return choice(
        prec.right(seq(';', repeat(item))),
        seq('{', repeat(item), '}'),
      );
    },

    // Annotations
    annotation: $ => seq(
      "#[",
      sepBy1(",", $.annotation_item),
      "]"
    ),

    annotation_expr: $ => choice(
      field("name", $.identifier),
      seq(
        field("name", $.identifier), "=", field("value", choice(field("local_const", seq('::', $.module_access)), $.module_access, $._literal_value))
      ),
    ),

    annotation_list: $ => seq(
      field("name", $.identifier),
      "(",
      sepBy(",", choice($._literal_value, $.annotation_item, $.module_access, field("local_const", seq('::', $.module_access)))),
      ")"
    ),

    annotation_item: $ => choice(
      field("annotation_expr", $.annotation_expr),
      field("annotation_list", $.annotation_list),
    ),

    // Constants
    constant: $ => seq(
      'const',
      field('name', alias($.identifier, $.constant_identifier)),
      ':',
      field('type', $._type),
      '=', field('expr', $._expression),
      ";"
    ),

    // Common parsers for datatype fields

    datatype_fields: $ => choice(
      $.positional_fields,
      $.named_fields,
    ),
    positional_fields: $ => seq(
      '(',
      sepBy(',', $._type),
      ')'
    ),
    named_fields: $ => seq(
      '{',
      sepBy(',', $.field_annotation),
      '}'
    ),

    // Enum definitions
    _enum_item: $ => choice(
      $.enum_definition,
    ),
    enum_definition: $ => seq(
      optional('public'),
      $._enum_signature,
      field('enum_variants', $.enum_variants),
      optional(field('postfix_ability_declarations', $.postfix_ability_decls)),
    ),
    _enum_signature: $ => seq(
      'enum',
      field('name', $._enum_identifier),
      optional(field('type_parameters', $.type_parameters)),
      optional(field('ability_declarations', $.ability_decls)),
    ),
    enum_variants: $ => seq(
      '{',
      sepBy(',', $.variant),
      '}'
    ),
    variant: $ => seq(
      field('variant_name', $._variant_identifier),
      optional(field('fields', $.datatype_fields)),
    ),

    // Struct definitions
    _struct_item: $ => choice(
      $.native_struct_definition,
      $.struct_definition,
    ),
    native_struct_definition: $ => seq(
      optional('public'),
      'native',
      $._struct_signature,
      ';',
    ),
    struct_definition: $ => seq(
      optional('public'),
      $._struct_signature,
      field('struct_fields', $.datatype_fields),
      optional(field('postfix_ability_declarations', $.postfix_ability_decls)),
      // positional structs without postfix abilities end in `;`: `struct P(u64);`
      optional(';'),
    ),
    field_annotation: $ => seq(
      // numeric names cover positional fields as rendered in IDE hover
      // signatures (`0: u64`)
      field('field', choice($._field_identifier, $.num_literal)),
      ':',
      field('type', $._type),
    ),
    // ability lists cannot be empty; trailing commas are tolerated because
    // prettier-move deliberately formats them away
    ability_decls: $ => seq(
      'has',
      sepBy1(',', $.ability),
    ),
    postfix_ability_decls: $ => seq(
      'has',
      sepBy1(',', $.ability),
      ';',
    ),

    _struct_signature: $ => seq(
      'struct',
      field('name', $._struct_identifier),
      optional(field('type_parameters', $.type_parameters)),
      optional(field('ability_declarations', $.ability_decls)),
    ),

    // Function definitions
    _function_item: $ => choice(
      $.native_function_definition,
      $.native_macro_function_definition,
      $.macro_function_definition,
      $.function_definition,
    ),
    native_function_definition: $ => seq(
      $._function_signature,
      ';'
    ),
    macro_function_definition: $ => seq(
      optional($.modifier),
      'macro',
      $._macro_signature,
      field('body', $.block)
    ),
    // `native macro fun foo();` — rejected later in the compiler pipeline but
    // accepted by its parser, so accept it here too.
    native_macro_function_definition: $ => seq(
      optional($.modifier),
      'macro',
      $._macro_signature,
      ';'
    ),
    _macro_signature: $ => seq(
      optional($.modifier),
      'fun',
      field('name', $._function_identifier),
      optional(field('type_parameters', $.type_parameters)),
      field('parameters', $.function_parameters),
      optional(field('return_type', $.ret_type)),
    ),
    function_definition: $ => seq(
      $._function_signature,
      field('body', $.block)
    ),
    _function_signature: $ => seq(
      repeat($.modifier),
      'fun',
      field('name', $._function_identifier),
      optional(field('type_parameters', $.type_parameters)),
      field('parameters', $.function_parameters),
      optional(field('return_type', $.ret_type)),
    ),
    function_parameters: $ => seq(
      '(',
      sepBy(',', choice($.mut_function_parameter, $.function_parameter)),
      ')',
    ),

    // Spec block start
    spec_block: $ => seq(
      'spec',
      choice(
        seq(optional(field('target', $._spec_block_target)), field('body', $.spec_body)),
        $._spec_function,
      )
    ),
    _spec_block_target: $ => choice(
      $.identifier,
      alias('module', $.spec_block_target_module),
      $.spec_block_target_schema,
    ),
    spec_block_target_fun: $ => seq('fun', $._function_identifier),
    spec_block_target_struct: $ => seq('struct', $._struct_identifier),
    spec_block_target_schema: $ => seq(
      'schema',
      field('name', $._struct_identifier),
      optional(field('type_parameters', $.type_parameters)),
    ),
    spec_body: $ => seq(
      '{',
      repeat($.use_declaration),
      repeat($._spec_block_memeber),
      '}'
    ),
    _spec_block_memeber: $ => choice(
      $.spec_invariant,
      $._spec_function,
      $.spec_condition,
      $.spec_include,
      $.spec_apply,
      $.spec_pragma,
      $.spec_variable,
      $.spec_let,
    ),
    spec_let: $ => seq(
      'let',
      optional('post'),
      field('name', $.identifier),
      '=',
      field('def', $._expression),
      ';'
    ),
    spec_condition: $ => choice(
      $._spec_condition,
      $._spec_abort_if,
      $._spec_abort_with_or_modifies,
    ),
    _spec_condition_kind: $ => choice(
      'assert',
      'assume',
      'decreases',
      'ensures',
      'succeeds_if',
    ),
    _spec_condition: $ => seq(
      choice(
        field('kind', alias($._spec_condition_kind, $.condition_kind)),
        seq(
          field('kind', alias('requires', $.condition_kind)),
          optional('module'),
        )
      ),
      optional(field('condition_properties', $.condition_properties)),
      field('expr', $._expression),
      ';'
    ),
    _spec_abort_if: $ => seq(
      field('kind', alias('aborts_if', $.condition_kind)),
      optional(field('condition_properties', $.condition_properties)),
      field('expr', $._expression),
      optional(seq('with', field('additional_exp', $._expression))),
      ';'
    ),
    _spec_abort_with_or_modifies: $ => seq(
      field('kind', alias(choice(
        'aborts_with',
        'modifies'
      ), $.condition_kind)),
      optional(field('condition_properties', $.condition_properties)),
      sepBy1(',', field('additional_exp', $._expression)),
      ';'
    ),

    spec_invariant: $ => seq(
      field('kind', alias('invariant', $.condition_kind)),
      optional(field('modifier', alias(choice('update', 'pack', 'unpack', 'module'), $.invariant_modifier))),
      optional(field('condition_properties', $.condition_properties)),
      field('expr', $._expression),
      ';'
    ),
    condition_properties: $ => seq('[', sepBy(',', $.spec_property), ']'),
    spec_include: $ => seq('include', $._expression, ';'),

    spec_apply: $ => seq(
      'apply',
      field('expr', $._expression),
      'to',
      sepBy1(',', $.spec_apply_pattern),
      optional(seq('except', sepBy1(',', $.spec_apply_pattern))),
      ';'
    ),
    spec_apply_pattern: $ => seq(
      optional(choice('public', 'internal')),
      field('name_pattern', $.spec_apply_name_pattern),
      optional(field('type_parameters', $.type_parameters)),
    ),
    spec_apply_name_pattern: $ => /[0-9a-zA-Z_*]+/,

    spec_pragma: $ => seq(
      'pragma',
      sepBy(',', $.spec_property),
      ';'
    ),
    spec_property: $ => seq($.identifier, optional(seq('=', $._literal_value))),

    spec_variable: $ => seq(
      optional(choice('global', 'local')),
      field('name', $.identifier),
      optional(field('type_parameters', $.type_parameters)),
      ':',
      field('type', $._type),
      ';'
    ),

    _spec_function: $ => choice(
      $.native_spec_function,
      $.usual_spec_function,
      $.uninterpreted_spec_function,
    ),

    uninterpreted_spec_function: $ => seq('fun', $._spec_function_signature, ';'),
    native_spec_function: $ => seq('native', 'fun', $._spec_function_signature, ';'),
    usual_spec_function: $ => seq(
      'fun',
      $._spec_function_signature,
      field('body', $.block)
    ),
    _spec_function_signature: $ => seq(
      field('name', $._function_identifier),
      optional(field('type_parameters', $.type_parameters)),
      field('parameters', $.function_parameters),
      optional(field('return_type', $.ret_type)),
    ),

    // Spec block end


    // move type grammar
    _type: $ => choice(
      $.apply_type,
      $.ref_type,
      $.tuple_type,
      $.function_type,
      $.primitive_type,
    ),
    apply_type: $ => prec.left(PRECEDENCE.apply_type, seq(
      $.module_access,
      optional(field('type_arguments', $.type_arguments)),
    )),
    ref_type: $ => seq(
      $._reference,
      $._type
    ),
    tuple_type: $ => seq('(', sepBy(',', $._type), ')'),
    primitive_type: $ => choice(
      'u8',
      'u16',
      'u32',
      'u64',
      'u128',
      'u256',
      'bool',
      'address',
      'signer',
    ),
    ret_type: $ => seq(':', $._type),

    // Unified name-access chain (the compiler's NameAccessChain model): any
    // number of `module:`-tagged prefix segments, each optionally carrying
    // type arguments, ending in a `member:`. `a::b` is module::member,
    // `a::b::C::D` is module::module::module::member — semantic roles
    // (module vs enum vs variant) are a naming-convention concern for
    // queries, exactly as in the compiler's AST. The dynamic precedence
    // prefers the path/type-arguments reading over `<`/`>` comparisons.
    module_access: $ => choice(
      // macro variable access
      seq('$', field('member', $.identifier)),
      // address access
      seq('@', field('member', $.identifier)),
      seq(
        field('member', alias($._reserved_identifier, $.identifier)),
        optional(field('type_arguments', $.type_arguments)),
      ),
      seq(
        field('member', $.identifier),
        optional(field('type_arguments', $.type_arguments)),
      ),
      prec.dynamic(1, seq(
        repeat1(choice(
          // a leading numeric address takes no type arguments
          seq(field('module', $.num_literal), '::'),
          seq(
            field('module', $._module_identifier),
            optional(field('type_arguments', $.type_arguments)),
            '::',
          ),
        )),
        field('member', $.identifier),
        optional(field('type_arguments', $.type_arguments)),
      )),
    ),

    friend_access: $ => choice(
      field('local_module', $.identifier),
      field('fully_qualified_module', $.module_identity),
      // `friend a::m::foo;` parses in the compiler (and errors later).
      seq(field('fully_qualified_module', $.module_identity), '::', field('member', $.identifier)),
    ),

    macro_module_access: $ => seq(field("access", $.module_access), "!"),

    module_identity: $ =>
      seq(
        field('address', choice($.num_literal, $._module_identifier)),
        '::',
        field('module', $._module_identifier)
      ),

    // KNOWN DIVERGENCE (backlog P6): the compiler only reads `<` as type
    // arguments in expression position when it is ADJACENT to the name, so
    // `h(a < b, c > (d))` is two comparisons. token.immediate cannot express
    // this here because whitespace is an extras token (once the whitespace
    // token is shifted, `<` is "immediate" again); the fix would need the
    // scanner to own whitespace and track adjacency state. See
    // test/corpus/known_failures.txt.
    type_arguments: $ => seq(
      '<',
      sepBy1(',', $._type),
      '>'
    ),

    function_type: $ => seq(
      field('param_types', $.function_type_parameters),
      optional(
        seq(
          '->',
          field('return_type', $._type)
        )
      )
    ),
    function_type_parameters: $ => seq('|', sepBy(',', $._type), '|'),

    // `mut <function_parameter>`
    mut_function_parameter: $ => seq(
      'mut',
      $.function_parameter,
    ),

    // function parameter grammar
    function_parameter: $ => seq(
      choice(
        field('name', $._variable_identifier),
        seq('$', field('name', $._variable_identifier)),
      ),
      ':',
      field('type', $._type),
    ),

    // type parameter grammar; the parameter list may be empty (`struct S<>()`)
    type_parameters: $ => seq('<', sepBy(',', $.type_parameter), '>'),
    type_parameter: $ => seq(
      optional('phantom'),
      optional('$'),
      $._type_parameter_identifier,
      optional(seq(':',
        sepByStrict1('+', $.ability)
      ))
    ),

    // Block

    block: $ => seq(
      '{',
      repeat($.use_declaration),
      repeat($.block_item),
      optional($._expression),
      '}'
    ),
    block_item: $ => seq(
      choice(
        $._expression,
        $.let_statement,
      ),
      ';'
    ),
    let_statement: $ => seq(
      'let',
      field('binds', $.bind_list),
      optional(seq(':', field('type', $._type))),
      optional(seq('=', field('expr', $._expression)))
    ),
    // Block end


    // Expression

    _expression: $ => choice(
      $.call_expression,
      $.macro_call_expression,
      $.lambda_expression,
      $.if_expression,
      $.while_expression,
      $.return_expression,
      $.abort_expression,
      $.assign_expression,
      // unary expression is included in binary_op,
      $._unary_expression,
      $.binary_expression,
      $.cast_expression,
      $.quantifier_expression,
      $.match_expression,
      $.vector_expression,
      $.loop_expression,
      $.identified_expression,
    ),

    identified_expression: $ => choice(
      seq(field('expression_id', $.block_identifier), $._expression),
      prec(PRECEDENCE.block_tail,
        seq(field('expression_id', $.block_identifier), $.block)),
    ),

    // `vector` here is the external-scanner token, emitted only when followed
    // by `[` or `<` (see src/scanner.c), so this cannot shadow ordinary uses
    // of `vector` as a module name.
    vector_expression: $ => seq(
      alias($._vector_keyword, 'vector'),
      optional(seq('<', sepBy1(',', $._type), '>')),
      '[',
      sepBy(",", $._expression),
      "]"
    ),

    quantifier_expression: $ => prec.right(seq(
      choice($._forall, $._exists),
      $.quantifier_bindings,
      optional(seq('where', $._expression)),
      ':',
      $._expression
    )),
    quantifier_bindings: $ => sepBy1(',', $.quantifier_binding),
    quantifier_binding: $ => choice(
      seq($.identifier, ':', $._type),
      seq($.identifier, 'in', $._expression)
    ),
    lambda_expression: $ => seq(
      field('bindings', $.lambda_bindings),
      optional(seq('->', $._type)),
      field('expr', $._expression)
    ),
    // A lambda parameter is any bind list — including a parenthesized tuple —
    // optionally type-ascribed: `|(a, b): (u64, u64)| ...`.
    lambda_binding: $ => seq(
      choice($.comma_bind_list, field('bind', $._bind)),
      optional(seq(':', field('ty', $._type))),
    ),
    lambda_bindings: $ => seq(
      '|',
      sepBy(',', $.lambda_binding),
      '|'
    ),
    // if-else expression. Each control expression has a block_tail variant:
    // when its final slot is a bare block, the whole expression terminates
    // before any binary operator (the compiler's ends_in_block rule).
    if_expression: $ => choice(
      prec.right(seq(
        'if', '(', field('eb', $._expression), ')',
        field('et', $._expression),
        'else',
        field('ef', $._expression),
      )),
      prec.right(PRECEDENCE.block_tail, seq(
        'if', '(', field('eb', $._expression), ')',
        field('et', $._expression),
        'else',
        field('ef', $.block),
      )),
      prec.right(seq(
        'if', '(', field('eb', $._expression), ')',
        field('et', $._expression),
      )),
      prec.right(PRECEDENCE.block_tail, seq(
        'if', '(', field('eb', $._expression), ')',
        field('et', $.block),
      )),
    ),

    // while expression
    while_expression: $ => choice(
      seq('while', '(', field('eb', $._expression), ')', field('body', $._expression)),
      prec(PRECEDENCE.block_tail,
        seq('while', '(', field('eb', $._expression), ')', field('body', $.block))),
    ),

    // loop expression
    loop_expression: $ => choice(
      seq('loop', field('body', $._expression)),
      prec(PRECEDENCE.block_tail, seq('loop', field('body', $.block))),
    ),

    // return expression
    return_expression: $ => choice(
      prec.left(seq(
        'return',
        optional(field('label', $.label)),
        field('return', $._expression)
      )),
      prec(PRECEDENCE.block_tail, seq(
        'return',
        optional(field('label', $.label)),
        field('return', $.block)
      )),
      prec(-1, seq('return', optional(field('label', $.label)))),
    ),

    // abort expression
    abort_expression: $ => choice(
      seq('abort', optional(field('abort', $._expression))),
      prec(PRECEDENCE.block_tail, seq('abort', field('abort', $.block))),
    ),

    match_expression: $ => seq(
      'match',
      '(',
      field('match_scrutiny', $._expression),
      ')',
      $._match_body,
    ),

    _match_body: $ => seq(
      '{',
      sepBy(',', $.match_arm),
      '}',
    ),

    match_condition: $ => seq(
      'if',
      '(',
      field('condition', $._expression),
      ')',
    ),

    match_arm: $ => seq(
      $.bind_list,
      optional($.match_condition),
      '=>',
      $._expression,
    ),

    call_expression: $ => prec.dynamic(1, seq(
      $.name_expression,
      field('args', $.arg_list),
    )),
    macro_call_expression: $ => seq(
      field('access', $.macro_module_access),
      optional(field('type_arguments', $.type_arguments)),
      field('args', $.arg_list),
    ),
    pack_expression: $ => seq(
      $.name_expression,
      field('body', $.field_initialize_list),
    ),
    name_expression: $ => seq(
      optional('::'),
      field('access', $.module_access),
    ),

    assign_expression: $ => prec.left(PRECEDENCE.assign,
      seq(
        field('lhs', $._unary_expression),
        '=',
        field('rhs', $._expression)
      )
    ),

    binary_expression: $ => {
      const table = [
        [PRECEDENCE.implies, '==>'],
        [PRECEDENCE.implies, '<==>'],
        [PRECEDENCE.or, '||'],
        [PRECEDENCE.and, '&&'],
        [PRECEDENCE.eq, '=='],
        [PRECEDENCE.neq, '!='],
        [PRECEDENCE.lt, '<'],
        [PRECEDENCE.gt, '>'],
        [PRECEDENCE.le, '<='],
        [PRECEDENCE.ge, '>='],
        [PRECEDENCE.range, '..'],
        [PRECEDENCE.bitor, '|'],
        [PRECEDENCE.xor, '^'],
        [PRECEDENCE.bitand, '&'],
        [PRECEDENCE.shl, '<<'],
        [PRECEDENCE.shr, '>>'],
        [PRECEDENCE.add, '+'],
        [PRECEDENCE.sub, '-'],
        [PRECEDENCE.mul, '*'],
        [PRECEDENCE.div, '/'],
        [PRECEDENCE.mod, '%']
      ];

      let binary_expression = choice(...table.map(
        ([precedence, operator]) => prec.left(precedence, seq(
          field('lhs', $._expression),
          field('operator', alias(operator, $.binary_operator)),
          field('rhs', $._expression),
        ))
      ));

      return binary_expression;
    },

    _unary_expression: $ => prec(11, choice(
      $.unary_expression,
      $.borrow_expression,
      $.dereference_expression,
      $.move_or_copy_expression,
      $._expression_term,
    )),
    // Prefix operators take a unary-level operand, as in the compiler's
    // parse_unary_exp: `!a && b` is `(!a) && b`, `*x = y` is `(*x) = y`.
    // parse_unary_exp bottoms out in parse_term, which admits control
    // expressions, so `&return x` / `&'a: loop {}` stay valid.
    _unary_operand: $ => choice(
      $._unary_expression,
      $.while_expression,
      $.loop_expression,
      $.return_expression,
      $.abort_expression,
      $.identified_expression,
    ),
    unary_expression: $ => seq(
      field('op', $.unary_op),
      field('expr', $._unary_operand)
    ),
    unary_op: $ => '!',

    // dereference
    dereference_expression: $ => prec.right(PRECEDENCE.unary, seq(
      '*',
      field('expr', $._unary_operand),
    )),
    // borrow
    borrow_expression: $ => prec(PRECEDENCE.unary, seq(
      $._reference,
      field('expr', $._unary_operand),
    )),
    // move or copy
    move_or_copy_expression: $ => prec(PRECEDENCE.unary, seq(
      choice('move', 'copy'),
      field('expr', $._unary_operand),
    )),

    _reference: $ => choice(
      $.imm_ref,
      $.mut_ref,
    ),

    _expression_term: $ => choice(
      $.call_expression,
      $.break_expression,
      $.continue_expression,
      $.name_expression,
      $.macro_call_expression,
      $.pack_expression,
      $._literal_value,
      $.unit_expression,
      $.expression_list,
      $.annotation_expression,
      $.block,
      $.spec_block,
      $.if_expression,

      $.dot_expression,
      $.index_expression,
      $.vector_expression,
      $.match_expression,
    ),
    break_expression: $ => seq(
      'break',
      optional(field('label', $.label)),
      optional(field('break', $._expression))
    ),
    continue_expression: $ => seq(
      'continue',
      optional(field('label', $.label)),
    ),

    field_initialize_list: $ => seq(
      '{',
      sepBy(',', $.exp_field),
      '}'
    ),

    arg_list: $ => seq(
      '(',
      sepBy(',', $._expression),
      ')'
    ),

    expression_list: $ => seq('(', sepBy1(',', $._expression), ')'),
    unit_expression: $ => seq('(', ')'),
    cast_expression: $ => prec.left(PRECEDENCE.as, seq(
      field('expr', $._expression),
      'as',
      field('ty', $._type),
    )),
    annotation_expression: $ => seq(
      '(',
      field('expr', $._expression),
      ':',
      field('ty', $._type),
      ')'
    ),


    dot_expression: $ => prec.left(PRECEDENCE.field, seq(
      field('expr', $._expression_term),
      '.',
      field('access', $._dot_access_term),
    )),
    // The right side of `.` is only ever a member (or method call): no
    // vector literals (`s.vector[0]` is a field access on a field named
    // `vector`) and no index — a trailing `[...]` indexes the whole chain,
    // as in the compiler's parse_dot_or_index_chain, so `a.b[0]` is
    // `(a.b)[0]`.
    _dot_access_term: $ => choice(
      $.call_expression,
      $.break_expression,
      $.continue_expression,
      $.name_expression,
      $.macro_call_expression,
      $.pack_expression,
      $._literal_value,
      $.unit_expression,
      $.expression_list,
      $.annotation_expression,
      $.block,
      $.spec_block,
      $.if_expression,
      $.match_expression,
      // positional field access `s.0` — the compiler only allows an
      // identifier or a field index after `.`
      alias(token(/\d+/), $.anon_field_index),
    ),
    index_expression: $ => prec.left(PRECEDENCE.call, seq(
      field('expr',
        $._expression_term,
      ),
      '[', sepBy(',', field('idx', $._expression)), ']'
    )),

    // Expression end

    // Fields and Bindings
    exp_field: $ => seq(
      field('field', $._field_identifier),
      optional(seq(
        ':',
        field('expr', $._expression)
      ))
    ),

    bind_list: $ => choice(
      $._bind,
      $.comma_bind_list,
      $.or_bind_list,
      $.paren_bind,
    ),
    at_bind: $ => seq($._variable_identifier, '@', $.bind_list),
    // dynamic precedence so `(x)` stays a comma_bind_list rather than a
    // paren_bind grouping
    comma_bind_list: $ => prec.dynamic(1, seq('(', sepBy(',', $._bind), ')')),
    // `A | B | C`, with parens only as balanced grouping: `(A | B)`.
    or_bind_list: $ => prec.left(seq($._or_bind, repeat1(seq('|', $._or_bind)))),
    _or_bind: $ => choice(
      $._bind,
      $.paren_bind,
    ),
    // balanced grouping around a nested or-list or a single pattern,
    // e.g. `(x @ Maybe::Nothing) | (x @ Maybe::Just(_))`
    paren_bind: $ => seq('(', choice($.or_bind_list, $._bind), ')'),

    mut_bind_var: $ => seq(
      'mut',
      alias($._variable_identifier, $.bind_var),
    ),

    _bind: $ => choice(
      choice(
        $.mut_bind_var,
        alias($._variable_identifier, $.bind_var)
      ),
      $.bind_unpack,
      $.at_bind,
      $._literal_value,
    ),
    bind_unpack: $ => seq(
      $.name_expression,
      optional(field('bind_fields', $.bind_fields)),
    ),
    bind_fields: $ => choice(
      $.bind_positional_fields,
      $.bind_named_fields,
    ),
    _spread_operator: _$ => '..',
    bind_positional_fields: $ => seq(
      '(', sepBy(',', choice($.bind_field, $.mut_bind_field)), ')'
    ),
    bind_named_fields: $ => seq(
      '{', sepBy(',', choice($.bind_field, $.mut_bind_field)), '}'
    ),

    mut_bind_field: $ => seq(
      'mut',
      $.bind_field,
    ),

    bind_field: $ => choice(seq(
      field('field', $.bind_list), // direct bind
      optional(seq(
        ':',
        field('bind', $.bind_list)
      ))
    ), $._spread_operator),
    // Fields and Bindings - End

    // literals
    _literal_value: $ => choice(
      $.address_literal,
      $.bool_literal,
      $.num_literal,
      $.hex_string_literal,
      $.byte_string_literal,
      $.string_literal,
      // $.vector_literal,
    ),

    imm_ref: $ => '&',
    mut_ref: $ => seq('&', 'mut'),
    block_identifier: $ => seq($.label, ':'),
    label: $ => seq('\'', $.identifier),
    // underscores are legal anywhere in the digits, including right after 0x
    address_literal: $ => /@(0x[a-fA-F0-9_]+|[0-9][0-9_]*)/,
    bool_literal: $ => choice('true', 'false'),
    num_literal: $ => prec.right(seq(
      choice(
        /[0-9][0-9_]*/,
        /0x[a-fA-F0-9_]+/
      ),
      optional(choice(
        'u8',
        'u16',
        'u32',
        'u64',
        'u128',
        'u256'
      ))
    )),
    // Strings cannot contain raw newlines (compiler lexer rule); this also
    // keeps an unclosed quote from swallowing the rest of the file.
    hex_string_literal: $ => /x"[0-9a-fA-F]*"/,
    byte_string_literal: $ => /b"(\\[^\n]|[^\\"\n])*"/,
    string_literal: $ => /"(\\[^\n]|[^\\"\n])*"/,
    _module_identifier: $ => alias($.identifier, $.module_identifier),
    _struct_identifier: $ => alias($.identifier, $.struct_identifier),
    _enum_identifier: $ => alias($.identifier, $.enum_identifier),
    _variant_identifier: $ => alias($.identifier, $.variant_identifier),
    _function_identifier: $ => alias($.identifier, $.function_identifier),
    _variable_identifier: $ => alias($.identifier, $.variable_identifier),
    _field_identifier: $ => alias($.identifier, $.field_identifier),
    _type_identifier: $ => alias($.identifier, $.type_identifier),
    _type_parameter_identifier: $ => alias($.identifier, $.type_parameter_identifier),
    identifier: $ => /(`)?[a-zA-Z_][0-9a-zA-Z_]*(`)?/,
    macro_identifier: $ => /[a-zA-Z_][0-9a-zA-Z_]*!/,
    _reserved_identifier: $ => choice($._forall, $._exists, 'spec'),

    _forall: $ => 'forall',
    _exists: $ => 'exists',
    // `///` doc comments expose doc_comment children used for markdown
    // injection; `////...` is a plain comment again, as in Rust. A contiguous
    // run of `///` lines (no blank or code line between) groups into ONE
    // line_comment node, so each run injects as its own markdown document —
    // a `# heading` provides context only within its own doc block. The
    // marker/content/continuation tokens are scanner tokens (see `externals`).
    line_comment: $ => choice(
      token(/\/\/[^\n]*/),
      seq(
        $._doc_line_marker,
        alias($._doc_line_content, $.doc_comment),
        repeat(seq($._doc_line_cont_marker, alias($._doc_line_content, $.doc_comment))),
        // zero-width scanner token: gives the extra rule an unambiguous ending
        $._doc_block_end,
      ),
    ),
    newline: $ => token(/\n/),
    _whitespace: $ => /\s/,
    // block_comment is an external token (src/scanner.c); see `externals`.
  }
});

//      (<rule> 'sep')* <rule>?
// Note that this allows an optional trailing `sep`.
function sepBy(sep, rule) {
  return seq(repeat(seq(rule, sep)), optional(rule));
}
function sepBy1(sep, rule) {
  return seq(rule, repeat(seq(sep, rule)), optional(sep));
}
// At least one <rule>, no trailing separator.
function sepByStrict1(sep, rule) {
  return seq(rule, repeat(seq(sep, rule)));
}
