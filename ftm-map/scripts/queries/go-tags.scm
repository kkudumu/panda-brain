; Functions
(function_declaration
  name: (identifier) @name.definition.function) @definition.function

; Methods
(method_declaration
  name: (field_identifier) @name.definition.method) @definition.method

; Type declarations
(type_declaration
  (type_spec
    name: (type_identifier) @name.definition.type)) @definition.type

; Call references
(call_expression
  function: [
    (identifier) @name.reference.call
    (selector_expression
      field: (field_identifier) @name.reference.call)
  ]) @reference.call
