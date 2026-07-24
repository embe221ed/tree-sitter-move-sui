; Parentheses
(expression_list
  "(" @delimiter
  ")" @delimiter @sentinel) @container

(unit_expression
  "(" @delimiter
  ")" @delimiter @sentinel) @container

(annotation_expression
  "(" @delimiter
  ")" @delimiter @sentinel) @container

(tuple_type
  "(" @delimiter
  ")" @delimiter @sentinel) @container

(function_parameters
  "(" @delimiter
  ")" @delimiter @sentinel) @container

(arg_list
  "(" @delimiter
  ")" @delimiter @sentinel) @container

(positional_fields
  "(" @delimiter
  ")" @delimiter @sentinel) @container

(bind_positional_fields
  "(" @delimiter
  ")" @delimiter @sentinel) @container

(comma_bind_list
  "(" @delimiter
  ")" @delimiter @sentinel) @container

(paren_bind
  "(" @delimiter
  ")" @delimiter @sentinel) @container

(function_type_parameters
  "|" @delimiter
  "|" @delimiter @sentinel) @container

(lambda_bindings
  "|" @delimiter
  "|" @delimiter @sentinel) @container

; Braces
(block
  "{" @delimiter
  "}" @delimiter @sentinel) @container

(module_body
  "{" @delimiter
  "}" @delimiter @sentinel) @container

(named_fields
  "{" @delimiter
  "}" @delimiter @sentinel) @container

(field_initialize_list
  "{" @delimiter
  "}" @delimiter @sentinel) @container

(bind_named_fields
  "{" @delimiter
  "}" @delimiter @sentinel) @container

(enum_variants
  "{" @delimiter
  "}" @delimiter @sentinel) @container

(spec_body
  "{" @delimiter
  "}" @delimiter @sentinel) @container

(use_module_members
  "{" @delimiter
  "}" @delimiter @sentinel) @container

; Square brackets
(annotation
  "#[" @delimiter
  "]" @delimiter @sentinel) @container

(index_expression
  "[" @delimiter
  "]" @delimiter @sentinel) @container

(vector_expression
  "[" @delimiter
  "]" @delimiter @sentinel) @container

(literal_list
  "[" @delimiter
  "]" @delimiter @sentinel) @container

(condition_properties
  "[" @delimiter
  "]" @delimiter @sentinel) @container

; Angle brackets
(type_arguments
  "<" @delimiter
  ">" @delimiter @sentinel) @container

; typed vector literals carry their own angle brackets: `vector<u8>[...]`
(vector_expression
  "<" @delimiter
  ">" @delimiter @sentinel) @container

(type_parameters
  "<" @delimiter
  ">" @delimiter @sentinel) @container
