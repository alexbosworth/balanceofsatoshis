# Contribution Guidelines

- Feel free to open issues or pull requests
- They may not be addressed or merged
- You can ignore coding styles if you want

## Coding Style

If you want to help with style, here are some rough guidelines on style ideas:

### Formatting

- Spaces not tabs, 2 spaces
- Arguments to methods are snake_case
- Regular variables are camelCase
- Returned attributes are snake_case
- Minimize function nesting, make new files if nesting is required
- No extraneous whitespace
- A single newline should appear at the end of a file
- A single line should contain max 80 characters including the newline
- If a top level scalar would go over 80 characters in a line, that's ok
- Don't bother with () in functions when not needed: `const a = b => c`
- If there are multiple things together, alphabetize them
- Don't split up long strings over multiple lines
- Lines should be terminated by explicit semicolons
- Logic like ternary operators should not extend beyond a single line
- Don't let any lines linger when they don't do anything
- Tightly space objects, like `{attribute: value}` not `{ attribute : value }`
- Use single '' quotes not double "" quotes, except when `` is required
- If conditions should avoid spanning multiple lines
- Avoid double specifying an attribute and value, `{type: type}` vs `{type}`
- Always use {} with if, else, etc statements
- Document the top of methods with what the arguments are and what is returned

### Control Flow

- Async functions should support both cbk and Promise style
- Use async.js methods for asynchronous control flow
- Use async auto and returnResult for all non-event async functions
- Try to exit early from functions when possible, and note this exit in comment
- Prefer cbk over Promise style, aside from in tests or in Promise libs
- Use `asyncAuto` for asynchronous control flow dependency management
- Callbacks should generally be named cbk even when redefinining in inner scope
- Avoid mixing non-async complex logic and async control flows in the same file
- Minimize async nesting in returned attributes and in method arguments
- Methods should always document their arguments and their output

### Variables

- Generally use undefined rather than null when defining nil types
- Prefer variable assignments on new lines rather than on a single line
- Reduce the usage of . property access, like isArray instead of Array.isArray
- When there is a newline in an object, always put a comma at the end of a line
- Short properties always go first in objects: `{short, longer: type}`
- If a statement relies on a statement above it, it should have a newline above
- Avoid including scalar values such as strings or numbers in the code itself
- Prefer hex serialization over base64 or Buffers in arguments or output
- Avoid any function arguments that are multiple data types

### JS Features

- Limit usage of `let` and never use `var`, prefer `const`
- Limit use of npm dependencies when possible, only use good dependencies
- Target support of the oldest node.js LTS release still being supported
- Never use class or prototype
- Do not import more methods from an import than you actually use
- Try to avoid passing objects in arguments as much as possible
- Prefer using function iteration like map and forEach over for and while
- Use arrow functions and not `function` functions whenever possible
- Functions should only take and return a single object as argument, result

### Errors

- Never ignore an error case, always deal with it as soon as possible
- In the case of errors, do include the error string in the code
- Add simple validations to help target simple calling mistakes
- When throwing or returning error messages, use PascalCase for the message
- Use HTTP status codes as a guideline: 4** is a local issue, 5** is remote
- Return async errors as arrays: `[typeNumber, errorMsgString, extraDetails]`
- Try to be very specific with error messages and try to not repeat one
- Callbacks should always be called as (err, result)
- Try and catch should not be used unless an error is expected
