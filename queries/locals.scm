; Scopes
[
  (source_file)
  (module_body)
  (block)
  (function_definition)
  (macro_function_definition)
  (lambda_expression)
  (match_arm)
  (spec_body)
] @local.scope

; Definitions
(function_parameter name: (variable_identifier) @local.definition.parameter)
(bind_var (variable_identifier) @local.definition.var)
(type_parameter (type_parameter_identifier) @local.definition.type)
(use_member alias: (identifier) @local.definition.import)
(use_member member: (identifier) @local.definition.import)
(use_module alias: (module_identifier) @local.definition.import)

; References: bare path members resolve against the scopes above.
(module_access member: (identifier) @local.reference)
