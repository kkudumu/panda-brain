; Functions
(function_declaration
  name: (identifier) @name.definition.function) @definition.function

; Methods
(method_definition
  name: (property_identifier) @name.definition.method) @definition.method

; Classes
(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

; Arrow functions assigned to const/let
(lexical_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: (arrow_function))) @definition.function

; Interfaces
(interface_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

; Type aliases
(type_alias_declaration
  name: (type_identifier) @name.definition.type) @definition.type

; Enums
(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum

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
