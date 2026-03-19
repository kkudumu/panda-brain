; Functions
(function_declaration
  name: (identifier) @name) @definition.function

; Methods
(method_definition
  name: (property_identifier) @name) @definition.method

; Classes
(class_declaration
  name: (identifier) @name) @definition.class

; Arrow functions assigned to const/let variables
(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (arrow_function))) @definition.function

; Arrow functions assigned to var variables
(variable_declaration
  (variable_declarator
    name: (identifier) @name
    value: (arrow_function))) @definition.function
