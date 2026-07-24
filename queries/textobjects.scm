; nvim-treesitter-textobjects queries

(function_definition
  body: (block) @function.inner) @function.outer
(macro_function_definition
  body: (block) @function.inner) @function.outer
(native_function_definition) @function.outer

(struct_definition
  struct_fields: (datatype_fields) @class.inner) @class.outer
(enum_definition
  enum_variants: (enum_variants) @class.inner) @class.outer

(function_parameter) @parameter.outer
(function_parameter
  name: (variable_identifier) @parameter.inner)
(arg_list
  (_) @parameter.inner)
(type_parameter) @parameter.outer

(call_expression
  args: (arg_list) @call.inner) @call.outer
(macro_call_expression
  args: (arg_list) @call.inner) @call.outer

(if_expression) @conditional.outer
(match_expression) @conditional.outer
(match_arm) @statement.outer

(while_expression) @loop.outer
(loop_expression) @loop.outer

[
  (line_comment)
  (block_comment)
] @comment.outer

(block) @block.outer
(block_item) @statement.outer
