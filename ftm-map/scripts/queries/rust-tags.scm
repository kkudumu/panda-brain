; Functions
(function_item
  name: (identifier) @name.definition.function) @definition.function

; Structs
(struct_item
  name: (type_identifier) @name.definition.struct) @definition.struct

; Enums
(enum_item
  name: (type_identifier) @name.definition.enum) @definition.enum

; Traits
(trait_item
  name: (type_identifier) @name.definition.trait) @definition.trait

; Impl blocks
(impl_item
  trait: (type_identifier) @name.definition.impl) @definition.impl

; Modules
(mod_item
  name: (identifier) @name.definition.module) @definition.module

; Macro definitions
(macro_definition
  name: (identifier) @name.definition.macro) @definition.macro

; Call references
(call_expression
  function: [
    (identifier) @name.reference.call
    (field_expression
      field: (field_identifier) @name.reference.call)
    (scoped_identifier
      name: (identifier) @name.reference.call)
  ]) @reference.call
