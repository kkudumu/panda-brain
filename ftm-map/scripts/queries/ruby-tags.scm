; Methods
(method
  name: (identifier) @name.definition.method) @definition.method

; Singleton methods
(singleton_method
  name: (identifier) @name.definition.method) @definition.method

; Classes
(class
  name: (constant) @name.definition.class) @definition.class

; Modules
(module
  name: (constant) @name.definition.module) @definition.module

; Call references
(call
  method: (identifier) @name.reference.call) @reference.call
