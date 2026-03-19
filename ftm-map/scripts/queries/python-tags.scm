; Functions
(function_definition
  name: (identifier) @name) @definition.function

; Classes
(class_definition
  name: (identifier) @name) @definition.class

; Decorated functions
(decorated_definition
  definition: (function_definition
    name: (identifier) @name) @definition.function)

; Decorated classes
(decorated_definition
  definition: (class_definition
    name: (identifier) @name) @definition.class)
