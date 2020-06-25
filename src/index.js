const seenRegExps = Object.create(null);

function memoRegExp(s) {
  if (seenRegExps[s]) {
    return seenRegExps[s];
  }
  return (seenRegExps[s] = new RegExp(s));
}

function shouldTransform(importName, opts) {
  if (!opts || !opts.libraries) {
    return importName === 'debug';
  }

  let libraries = opts.libraries;
  if (typeof libraries === 'string') {
    libraries = [libraries];
  }

  for (var i = 0; i < libraries.length; ++i) {
    if (memoRegExp(libraries[i]).exec(importName)) {
      return true;
    }
  }
  return false;
}

module.exports = function babelRemoveDebug(babel) {
  const t = babel.types;
  const assignment = babel.template('var IMPORT = REPLACE;');
  const mockAssignment = babel.template('IMPORT.PROPERTY = MOCK;');
  const noopConstructor = babel.template.ast('()=>()=>{}').expression;
  const noopEnabled = babel.template.ast('()=>false').expression;
  const noopEnable = babel.template.ast('()=>{}').expression;
  const noopLog = babel.template.ast('()=>{}').expression;

  const knownMethods = Object.create(null);
  knownMethods.enable = noopEnable;
  knownMethods.enabled = noopEnabled;

  const removeCall = (usage, varname) => {
    usage.scope.crawl();
    let binding = usage.scope.getBinding(varname);
    if (binding) {
      binding.referencePaths.forEach(p => {
        let parentPath = p.parentPath;
        if (parentPath.isCallExpression() && parentPath.node.callee.name === varname) {
          parentPath.remove();
        } else {
          p.replaceWith(noopLog);
        }
      });
    }
    usage.parentPath.parentPath.remove();
  }


  const processVars = (path, importedAs, mockMethods) => {
    let needsImportAlias = false;

    path.scope.crawl();
    const importUses = path.scope.getBinding(importedAs);

    const cannotRemoveUsages = importUses.constantViolations.length > 0;

    importUses.referencePaths.forEach(usage => {
      needsImportAlias |= processOneVar(usage, importedAs, cannotRemoveUsages, mockMethods);
    });
    return needsImportAlias;
  };

  const processOneVar = (usage, importedAs, cannotRemoveUsages, mockMethods) => {
    var needsImportAlias = false;
          if (usage.parentPath.isVariableDeclarator()) {
            // alias of the Debug constructor (eg `let x = Debug;`)
            return true;
          }

          // Something like Debug.someProperty
          if (usage.parentPath.isMemberExpression()) {
            const memberExpression = usage.parentPath;
            if (memberExpression.get('object').isIdentifier() && memberExpression.node.object.name === importedAs) {
              const property = memberExpression.get('property');
              const constantMemberName = (
                property.isIdentifier() ? property.node.name : (
                  (property.isStringLiteral() ? property.node.value : null)
                )
              );
              if (constantMemberName && knownMethods[constantMemberName]) {
                if (cannotRemoveUsages) {
                  mockMethods[constantMemberName] = knownMethods[constantMemberName];
                  needsImportAlias = true;
                } else {
                  if (constantMemberName === 'enabled') {
                    memberExpression.parentPath.replaceWith(t.BooleanLiteral(false));
                  } else {
                    memberExpression.parentPath.remove();
                  }
                }
              } else if (constantMemberName) {
                // some unknown property is being accessed
                needsImportAlias = true;
                mockMethods[constantMemberName] = noopLog;
              } else {
                // Dangerous; we can't safely mock this. But also
                // super unlikely anyone would ever do this
                needsImportAlias = true;
              }
            }
            // Debug was used as property lookup!?
            return needsImportAlias;
          }

          const callExpression = usage.parentPath;

          if (!callExpression.isCallExpression() ||
            callExpression.node.callee.name !== importedAs) {
            return needsImportAlias;
          }

          const user = callExpression.parentPath;
          if (user.isVariableDeclarator()) { // x = Debug('...');
            removeCall(usage, user.node.id.name);
          } else if (user.isExpressionStatement()) { // Debug('...');
            user.remove();
          } else if (user.isCallExpression()) {
            if (user.parentPath.isExpressionStatement()) {
              user.parentPath.remove(); // Debug('...')('log line', 1, 2);
            } else { // 1 + Debug('...')('log line', 1, 2);
              user.replaceWith(t.identifier('undefined'));
            }
          }
    return needsImportAlias;
  };

  return {
    visitor: {
      CallExpression(path, state) {
        let { node } = path;
        if (!t.isIdentifier(node.callee, { name: "require" })) {
          return;
        };
        if (node.arguments.length !== 1) {
          return;
        };
        if (!shouldTransform(node.arguments[0].value, state.opts)) {
          return;
        };
        let { parentPath } = path;
        if (parentPath.isVariableDeclarator()) {
          const importedAs = path.parent.id.name; // var Debug = require('debug');
          const mockMethods = Object.create(null);
          if (processVars(path, importedAs, mockMethods)) {
            parentPath.parentPath.replaceWithMultiple([ //var Debug = require('debug');const Debug1=Debug;
              assignment({
                IMPORT: parentPath.node.id,
                REPLACE: noopConstructor
              })
            ].concat(Object.keys(mockMethods).map(k =>
              mockAssignment({
                IMPORT: parentPath.node.id,
                PROPERTY: k,
                MOCK: mockMethods[k]
              })
            )));
          } else {
            parentPath.remove(); //var Debug = require('debug');const debug=Debug('tag');
          }
        } else if (parentPath.isCallExpression()) {
          let varPath = parentPath.parentPath; // var debug = require('debug')('tag');
          if (varPath.isVariableDeclarator()) {
            removeCall(path, varPath.node.id.name);
          }
        }
      },
      ImportDeclaration(path, state) {
        if (!shouldTransform(path.node.source.value, state.opts)) {
          return;
        }

        const defaultSpecifier = path.get('specifiers').find(specifier => {
          return specifier.isImportDefaultSpecifier();
        });

        if (!defaultSpecifier) {
          path.remove();
          return;
        }

        const importedAs = defaultSpecifier.node.local.name;
        const mockMethods = Object.create(null);
        if (processVars(path, importedAs, mockMethods)) {
          path.replaceWithMultiple([
            assignment({
              IMPORT: defaultSpecifier.node.local,
              REPLACE: noopConstructor
            })
          ].concat(Object.keys(mockMethods).map(k =>
            mockAssignment({
              IMPORT: defaultSpecifier.node.local,
              PROPERTY: k,
              MOCK: mockMethods[k]
            })
          )));
        } else {
          path.remove(); //import Debug from 'debug'
        }
      }
    }
  };
};
