; ADT definitions

(struct_definition
    name: (struct_identifier) @name) @definition.class

(enum_definition
    name: (enum_identifier) @name) @definition.class

; function definitions

(function_definition
    name: (function_identifier) @name) @definition.function

(macro_function_definition
    name: (function_identifier) @name) @definition.function

(native_function_definition
    name: (function_identifier) @name) @definition.function

; constants and modules

(constant
    name: (constant_identifier) @name) @definition.constant

(module_definition
    module_identity: (module_identity) @name) @definition.module

; references

(call_expression
    (name_expression
        access: (module_access member: (identifier) @name))) @reference.call

(macro_call_expression
    access: (macro_module_access
        access: (module_access member: (identifier) @name))) @reference.call
