var babel = require('@babel/core');
var assert = require('assert');
var plugin = require('../');

function transform(code, opts) {
  return babel.transform(code, {
    babelrc: false,
    compact: true,
    plugins: [opts ? [plugin, opts] : plugin],
    parserOpts: {
      plugins: ['*']
    }
  }).code;
}

function assertTransform(testName, input, expectedOutput) {
  // Normalize whitespace to account for babel pretty printing the output
  it(testName, () => {
    assert.equal(transform(input).replace(/\n/g, ''), expectedOutput);
  });
}

// TODO: debug.formatters.h = v => {...}
// TODO: debug.log = console.info.bind(console)
// TODO: a = debug('hi'); b = a.extend('yo')
// TODO: debug.enabled(''); debug.enable(''); debug.disable('')
// TODO: debug('hi').enabled

assertTransform(
  'should remove imports',
  `import Debug from 'debug';`,
  ''
);

assertTransform(
  'removes silly empty imports',
  `import 'debug';`,
  ''
);

assertTransform(
  'should leave non-debug imports alone',
  `import x from'foo';import Debug from 'debug';`,
  `import x from'foo';`
);

assertTransform(
  'should remove applications of the debug constructor',
  `import x from'foo';import Debug from 'debug';let d=Debug('hi');Debug('foo');x();`,
  `import x from'foo';x();`
);

assertTransform(
  'should noop aliases of the debug constructor',
  `import Debug from 'debug';let y=Debug;x=y('foo');x();`,
  `var Debug=()=>()=>{};let y=Debug;x=y('foo');x();`
);

assertTransform(
  'should noop rename aliases of the debug constructor',
  `import Debug from 'debug';let y=Debug;Debug=y;x=Debug('foo');x();`,
  `var Debug=()=>()=>{};let y=Debug;Debug=y;x=Debug('foo');x();`
);

assertTransform(
  'should remove usages of the debug function',
  `import x from'foo';import Debug from 'debug';let d=Debug('hi');d('foo', 1, 2, 3);x();`,
  `import x from'foo';x();`
);

assertTransform(
  'should handle scopes correctly',
  `import D from 'debug';function y(){let d=D('hi');}d('foo',1,2,3);`,
  `function y(){}d('foo',1,2,3);`
);

assertTransform(
  'replaces with noop if variable escapes the scope',
  `import D from 'debug';function y(){let d=D('hi2');d('yo');return d;}`,
  `function y(){return()=>{};}`
);

assertTransform(
  'should noop aliased usages of the debug function',
  `import Debug from 'debug';let d=Debug('hi');d('foo', 1, 2, 3);x=d;x();`,
  `x=()=>{};x();`
);

assertTransform(
  'remove simple Debug.enable references',
  `import Debug from 'debug';Debug.enable;`,
  ``
);

assertTransform(
  'remove simple Debug.enable calls',
  `import Debug from 'debug';Debug.enable('hi,-*');`,
  ``
);

assertTransform(
  `remove simple Debug['enable'] references`,
  `import Debug from 'debug';Debug['enable'];`,
  ``
);

assertTransform(
  `remove simple Debug['enable'] references`,
  `import Debug from 'debug';Debug['enable']('hi,-*');`,
  ``
);

assertTransform(
  `noop complex Debug['ena' + 'ble'] references`,
  `import Debug from 'debug';Debug['ena' + 'ble'];`,
  `var Debug=()=>()=>{};Debug['ena'+'ble'];`
);

assertTransform(
  'noop Debug.enable usages in prescence of weird aliasing',
  `import Debug from 'debug';x=Debug;Debug=1;Debug.enable('hi');`,
  `var Debug=()=>()=>{};Debug.enable=()=>{};x=Debug;Debug=1;Debug.enable('hi');`
);
