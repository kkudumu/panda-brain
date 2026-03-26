; Functions
(function_declaration
  name: (identifier) @name.definition.function) @definition.function

; Methods
(method_definition
  name: (property_identifier) @name.definition.method) @definition.method

; Classes
(class_declaration
  name: (identifier) @name.definition.class) @definition.class

; Arrow functions assigned to const/let
(lexical_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: (arrow_function))) @definition.function

; Arrow functions assigned to var
(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: (arrow_function))) @definition.function

; Call references
(call_expression
  function: [
    (identifier) @name.reference.call
    (member_expression
      property: (property_identifier) @name.reference.call)
  ]) @reference.call

; New expressions
(new_expression
  constructor: (identifier) @name.reference.class) @reference.class
