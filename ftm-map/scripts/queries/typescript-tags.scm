; Functions
(function_declaration
  name: (identifier) @name) @definition.function

; Methods
(method_definition
  name: (property_identifier) @name) @definition.method

; Classes
(class_declaration
  name: (type_identifier) @name) @definition.class

; Arrow functions assigned to const/let variables
(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (arrow_function))) @definition.function

; Interfaces
(interface_declaration
  name: (type_identifier) @name) @definition.class

; Type aliases
(type_alias_declaration
  name: (type_identifier) @name) @definition.type

; Enums
(enum_declaration
  name: (identifier) @name) @definition.class
