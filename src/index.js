const seenRegExps = Object.create(null);
function memoRegExp(s) {
  if (seenRegExps[s]) {
    return seenRegExps[s];
  }
  return (seenRegExps[s] = new RegExp(s));
}

function shouldTransformImport(importName, opts) {
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

function shouldTransform(path, opts) {
  let importedLibraryName = path.node.source.value;
  return shouldTransformImport(importedLibraryName, opts);
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

  return {
    visitor: {
      ImportDeclaration(path, state) {
        if (!shouldTransform(path, state.opts)) {
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
        path.scope.crawl();
        const importUses = path.scope.getBinding(importedAs);

        const cannotRemoveUsages = importUses.constantViolations.length > 0;
        const mockMethods = Object.create(null);
        let needsImportAlias = false;

        importUses.referencePaths.forEach(usage => {
          if (usage.parentPath.isVariableDeclarator()) {
            // alias of the Debug constructor (eg `let x = Debug;`)
            needsImportAlias=true;
            return;
          }

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
            return;
          }

          const callExpression = usage.parentPath;

          if (!callExpression.isCallExpression() ||
             callExpression.node.callee.name !== importedAs) {
            return;
          }

          const user = callExpression.parentPath;
          if (user.isVariableDeclarator()) { // x = Debug('...');
            usage.scope.crawl();
            let binding = usage.scope.getBinding(user.node.id.name);
            if (binding) {
              binding.referencePaths.forEach(p => {
                if (p.parentPath.isCallExpression()) {
                  p.parentPath.remove();
                } else {
                  p.replaceWith(noopLog);
                }
              });
            }
            usage.parentPath.parentPath.remove();
          } else if (user.isExpressionStatement()) { // Debug('...');
            user.remove();
          }
        });

        if (needsImportAlias) {
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
          path.remove();
        }
      }
    }
  };
};
