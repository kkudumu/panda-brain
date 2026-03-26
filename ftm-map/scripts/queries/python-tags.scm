; Module-level constants
(module
  (expression_statement
    (assignment
      left: (identifier) @name.definition.constant) @definition.constant))

; Classes
(class_definition
  name: (identifier) @name.definition.class) @definition.class

; Functions
(function_definition
  name: (identifier) @name.definition.function) @definition.function

; Decorated definitions (functions)
(decorated_definition
  definition: (function_definition
    name: (identifier) @name.definition.function)) @definition.function

; Decorated definitions (classes)
(decorated_definition
  definition: (class_definition
    name: (identifier) @name.definition.class)) @definition.class

; Call references (direct function calls and attribute method calls)
(call
  function: [
    (identifier) @name.reference.call
    (attribute
      attribute: (identifier) @name.reference.call)
  ]) @reference.call
