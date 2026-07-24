;; Highlights file for Move

;; Comments
(line_comment) @comment
(
  (line_comment) @comment.documentation
  (#match? @comment.documentation "^\\\/\\\/\\\/([^/].*)?$")
)
(block_comment) @comment
(
  (block_comment) @comment.documentation
  (#match? @comment.documentation "^\\\/\\\*\\\*(\\n|[^*].*)")
)
(doc_comment) @comment.documentation

;; Baseline: any bare path member is a variable reference until a more
;; specific rule below (constants, calls, types, macros) overrides it.
(module_access member: (identifier) @variable)

;; Constant usage conventions.
;; These sit early on purpose: in type positions the more specific type rules
;; below override them (in nvim the capture from the later pattern wins).
;; SCREAMING_SNAKE_CASE identifiers are constants...
((identifier) @constant
  (#match? @constant "^[A-Z][A-Z0-9_]+$"))
;; ...and so are `EPascalCase` error constants (`abort EInvalidArg`).
((identifier) @constant
  (#match? @constant "^E[A-Z][A-Za-z0-9_]*$"))

;; Types
(type_parameter_identifier) @type
(primitive_type) @type.builtin
(struct_identifier) @type

;; Enhanced type handling
(apply_type
  (module_access
    (identifier) @type))
(apply_type
  (module_access
    (identifier) @type.defaultLibrary @type.builtin
    (#match? @type.defaultLibrary "^(u8|u16|u32|u64|u128|u256|bool|address|signer|vector)$")))

;; Annotations
(annotation) @attribute @annotation
(annotation_item) @annotation.item

(annotation_item
  (annotation_list
    name: (identifier) @function.macro))

(annotation
  (annotation_item
    (annotation_expr
      name: (identifier) @function.macro)))

;; Constants
(constant_identifier) @constant
(constant name: (constant_identifier) @constant)
(constant expr: (num_literal) @constant.value)

;; Identifier baselines. These come before the more specific rules below so
;; that e.g. @variable.parameter is not clobbered by the blanket @variable.
(variable_identifier) @variable
(field_identifier) @variable.member @property

;; Function definitions. The blanket comes first so the definition-specific
;; rules below (notably the macro one) win.
(function_identifier) @function.name
(function_definition name: (function_identifier) @function)
(macro_function_definition name: (function_identifier) @macro @function.macro)
(native_function_definition name: (function_identifier) @function)
(usual_spec_function name: (function_identifier) @function)
(function_parameter name: (variable_identifier) @variable.parameter)

;; Function parameter modifications. @variable.parameter first so the custom
;; captures only refine when a theme defines them.
(function_parameters
  (function_parameter
    name: (variable_identifier) @variable.parameter @parameter.modification
    type: (ref_type
      (mut_ref))))
(function_parameters
  (function_parameter
    name: (variable_identifier) @variable.parameter @parameter.readonly
    type: (ref_type
      (imm_ref))))

;; Module definitions
"extend" @keyword
(module_identifier) @namespace.module.name
(module_identity address: (module_identifier) @namespace.module.address)
; (module_identity module: (module_identifier)  @namespace.module.name)
(module_definition
  (module_identity 
    address: (module_identifier) @namespace.module.address
    module: (module_identifier) @namespace.module.name))
(use_module_members
  (module_identity
    address: (module_identifier) @namespace.module.address
    module: (module_identifier) @namespace.module.name))
(use_module_member
  (module_identity
    address: (module_identifier) @namespace.module.address
    module: (module_identifier) @namespace.module.name))
(use_module_members
  address: (module_identifier) @namespace.module.address)

;; Function calls: any number of `module:` prefix segments, one final member.
(call_expression (name_expression access: (module_access module: (module_identifier) @namespace.module.name)))
(call_expression (name_expression access: (module_access member: (identifier) @function.call)))

(label (identifier) @label)

;; Macro calls
(macro_call_expression
  access: (macro_module_access) @function.macro @macro.call)

;; Literals
(num_literal) @number
(bool_literal) @boolean
(hex_string_literal) @string.hex
(byte_string_literal) @string.byte
(string_literal) @string
(address_literal) @number @number.address

;; Uses
(use_member member: (identifier) @include.member)
(use_module
  (module_identity
    address: (module_identifier) @namespace.module.address
    module: (module_identifier) @namespace.module.name)
  alias: (module_identifier)? @namespace.module.name)

(use_fun (module_access module: (module_identifier) @namespace.module.name))
(use_fun (module_access member: (identifier) @include.member))

;; Enhanced use statements
(use_member
  module: (identifier)? @namespace.module.name
  member: (identifier)? @variable.member
  alias: (identifier)? @variable.member)
;; Only PascalCase imports are datatypes; lowercase ones are functions/modules.
((use_member
  member: (identifier) @type)
  (#match? @type "^[A-Z]"))
(use_fun
  (module_access
    member: (identifier) @function)
  alias: (module_access
    member: (identifier) @type)
  alias: (function_identifier) @function)

;; Friends
(friend_declaration
  module: (friend_access
    (module_identity
      address: (module_identifier) @namespace.module.address
      module: (module_identifier) @namespace.module.name)))

;; Structs
(struct_definition name: (struct_identifier) @type.definition.struct)
(ability) @type.ability

;; Enums
(enum_identifier) @type
(enum_definition name: (enum_identifier) @type.definition.struct)
(variant variant_name: (variant_identifier) @constructor.name @constructor)

;; Packs
(pack_expression (name_expression access: (module_access) @constructor.name))
(pack_expression
  (name_expression
    access: (module_access
    (identifier) @struct @type)))

;; Unpacks
(bind_unpack
  (name_expression
    access: (module_access
    (identifier) @struct @type)))

;; Datatype/variant conventions. The grammar cannot tell `Enum::Variant` from
;; `module::function`, so lean on Move naming conventions: a PascalCase path
;; segment is a datatype, and the member following it is a variant (or other
;; associated item). These come after the call/namespace rules above so that
;; they win for enum paths like `Color::Red` and `Option::Some(x)`.
((module_access
  module: (module_identifier) @type)
  (#match? @type "^[A-Z]"))
((module_access
  module: (module_identifier) @_dt
  member: (identifier) @constructor)
  (#match? @_dt "^[A-Z]"))

;; Enum variants in hover signatures / snippet items: the PascalCase path
;; segment before the variant is the enum type, the variant a constructor.
(hover_variant
  variant: (variant_identifier) @constructor)
((hover_variant
  path: (module_identifier) @type)
  (#match? @type "^[A-Z]"))

;; Macro names: the final path segment of a macro call is the macro itself,
;; not a module (`constants::b9_scaling!()`). Kept after the module/namespace
;; rules so it wins for that segment.
(macro_module_access
  access: (module_access
    member: (identifier) @function.macro))
(macro_module_access "!" @function.macro)

;; Vector literals: `vector[...]` / `vector<T>[...]`.
(vector_expression "vector" @type.builtin)

(module_access "$" (identifier) @macro.variable)
"$" @macro.variable

; (module_access module: (module_identifier) member: (identifier) @constructor.name)

(mut_ref) @keyword

;; Expressions
(dot_expression
  access: (name_expression) @property)

(quantifier_binding
  (identifier) @variable.parameter @parameter)

;; Lambdas
; (lambda_binding bind: (bind_var (variable_identifier) @variable.parameter))
; (lambda_bindings (bind_var (variable_identifier) @variable.parameter))

;; Operators
(binary_operator) @operator
(unary_op) @operator
(binary_expression
  operator: (binary_operator) @operator)
"=>" @operator
"@" @operator
"->" @operator

;; Specs
(spec_block target: (identifier) @function.spec.target)
(spec_pragma) @preproc.annotation.spec
(spec_condition kind: (condition_kind) @condition.spec)
(condition_properties) @preproc.spec.condition.properties

;; Enhanced spec support
(spec_let
  name: (identifier) @property)
(spec_property
  (identifier) @property)
(spec_variable
  name: (identifier) @variable)
(spec_apply_name_pattern) @type @struct
(condition_kind) @keyword @macro
(invariant_modifier) @keyword.modifier @modifier

; (match_expression "match") @keyword

;; Punctuation
"&" @operator
"(" @punctuation.bracket
")" @punctuation.bracket
"[" @punctuation.bracket
"]" @punctuation.bracket
"{" @punctuation.bracket
"}" @punctuation.bracket

(type_arguments
  "<" @punctuation.bracket
  ">" @punctuation.bracket)

(type_parameters
  "<" @punctuation.bracket
  ">" @punctuation.bracket)

"::" @punctuation.delimiter
":" @punctuation.delimiter
"." @punctuation.delimiter
"," @punctuation.delimiter
";" @punctuation.delimiter

;; Keywords (single merged list; granular subtypes follow and win)
[
  "fun"
  "native"
  "struct"
  "enum"
  "use"
  "public"
  "package"
  "module"
  "const"
  "let"
  "has"
  "friend"
  "entry"
  "mut"
  "macro"
  "break"
  "continue"
  "spec"
  "schema"
  "include"
  "apply"
  "to"
  "with"
  "internal"
  "pragma"
  "global"
  "local"
  "copy"
  "drop"
  "key"
  "store"
  "move"
  "phantom"
] @keyword

[
  "if"
  "else"
  "match"
] @keyword.conditional

[
  "while"
  "loop"
] @keyword.repeat

[
  "return"
  "abort"
] @keyword.return

[
  "use"
  "friend"
] @keyword.import

[
  "public"
  "entry"
  "native"
  "has"
  "mut"
  "phantom"
] @keyword.modifier

[
  "fun"
  "macro"
] @keyword.function

"as" @keyword.operator

;; `address` is a keyword only when opening an address block; everywhere else
;; it is the builtin type (already covered by the primitive_type rule).
(address_block "address" @keyword)
