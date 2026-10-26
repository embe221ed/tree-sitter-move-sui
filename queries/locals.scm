; Scopes
[
  (source_file)
  (module_body)
  (block)
  (struct_definition)
  (native_struct_definition)
  (enum_definition)
  (function_definition)
  (native_function_definition)
  (macro_function_definition)
  (native_macro_function_definition)
  (lambda_expression)
  (match_arm)
  (spec_body)
  (spec_block)
  (usual_spec_function)
  (native_spec_function)
  (uninterpreted_spec_function)
] @local.scope

; Canonical captures support the standard Tree-sitter highlighter; the
; suffixed captures retain the existing editor-specific definition categories.
; Definitions
(function_parameter name: (variable_identifier) @local.definition @local.definition.parameter)
; A bind_var also appears on the label side of `S { field: value }`.
; Capture binding positions explicitly so field labels do not define locals.
(let_statement binds: (bind_list (bind_var (variable_identifier) @local.definition @local.definition.var)))
(match_arm (bind_list (bind_var (variable_identifier) @local.definition @local.definition.var)))
(lambda_binding bind: (bind_var (variable_identifier) @local.definition @local.definition.var))
(comma_bind_list (bind_var (variable_identifier) @local.definition @local.definition.var))
(or_bind_list (bind_var (variable_identifier) @local.definition @local.definition.var))
(paren_bind (bind_var (variable_identifier) @local.definition @local.definition.var))
(mut_bind_var (bind_var (variable_identifier) @local.definition @local.definition.var))
(at_bind (variable_identifier) @local.definition @local.definition.var)
(at_bind (bind_list (bind_var (variable_identifier) @local.definition @local.definition.var)))
(bind_field !bind field: (bind_list (bind_var (variable_identifier) @local.definition @local.definition.var)))
(bind_field bind: (bind_list (bind_var (variable_identifier) @local.definition @local.definition.var)))
(type_parameter (type_parameter_identifier) @local.definition @local.definition.type)
(use_member alias: (identifier) @local.definition @local.definition.import)
(use_member !alias member: (identifier) @local.definition @local.definition.import)
(use_module alias: (module_identifier) @local.definition @local.definition.import)

; Qualified paths, dotted properties/methods, and named addresses do not resolve
; against same-named locals. Their receivers and type arguments still do.
(module_access !module !property !address member: (identifier) @local.reference)
