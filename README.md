# babel-plugin-remove-debug

Removes usage of the popular [debug](https://www.npmjs.com/package/debug) library from code.

The following:

```javascript
import foo from './foo';
import Debug from 'debug';
const debug = Debug('bar');

function bar(x) {
   debug('Doing something');
   foo(1, x);
}
```

will be transformed into:

```javascript
import foo from './foo';

function bar(x) {
   foo(1, x);
}
```

This is useful to help save on bundle size and be sure that log messages aren't being shown to clients. It also makes it safe to leave in potentially-expensive logging messages for development and be confident they won't impact production runtimes at all.

## Limitations

- Will only work if `debug` is imported with ES6 import syntax. `require('debug')` is not supported.

## Options

A typical setup

    {
        "plugins": ["babel-plugin-remove-debug"]
    }

By default this will apply to all import of `'debug'`. If you are using a compatible but differently named package, or otherwise have the import name aliased, you can specify that using the `libraries` option. It accepts an array of regular expressions (as strings). For example:

    {
        "plugins": [
            ["babel-plugin-remove-debug", {
               "libraries": [
                 "^debug$",
                 "^@mycompany/debug-fork-(1|2|3)$"
               ]
            }]
        ]
    }
