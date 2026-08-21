/**
 * Custom ESLint rule: require-openapi-tag
 *
 * Requires every route-handler registration to carry a preceding JSDoc block containing
 * an `@openapi` tag, so the generated OpenAPI spec describes every mounted endpoint.
 *
 * A registration whose path is not a string literal — a constant or a template literal —
 * is skipped: without the path there is nothing to name in the report, and no route
 * registers that way today. That is the rule's blind spot, stated rather than hidden.
 *
 * `jsdoc/require-jsdoc` already requires *a* JSDoc block on these call sites, and
 * `jsdoc/check-tag-names` only validates tags that are present — so a handler with a
 * plain descriptive comment and no `@openapi` satisfies both while being invisible to
 * swagger-jsdoc. That gap is why the spec drifted from the routes.
 */
import { OPENAPI_BLOCK } from './work-item-id-patterns.mjs';

/**
 * A tag with nothing under it is worse than no tag: swagger-jsdoc parses the empty
 * annotation and consumes the NEXT one, so the following endpoint silently leaves the
 * spec. Require at least one non-blank line after the tag line.
 */
function hasAnnotationBody(commentValue) {
  const lines = commentValue.split('\n');
  const tagIndex = lines.findIndex((line) => /^\s*\*?\s*@openapi\s*$/.test(line));
  if (tagIndex === -1) return false;
  return lines.slice(tagIndex + 1).some((line) => line.replace(/^\s*\*?/, '').trim() !== '');
}

/**
 * Method names Express registers handlers under. `all` is included: it registers for
 * every HTTP method, so it needs a spec entry more than the others, not less.
 */
const HANDLER_METHODS = /^(get|post|patch|delete|put|all)$/;

/** @type {import('eslint').Rule.RuleModule} */
const requireOpenapiTag = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require an @openapi JSDoc tag on every route handler registration',
      recommended: false,
    },
    schema: [],
    messages: {
      missingOpenapiTag:
        'Route handler {{ method }} {{ path }} has no @openapi block, so it is absent ' +
        'from the generated spec. Document it, or add an eslint-disable with the reason ' +
        'it is deliberately undocumented.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.property.type !== 'Identifier' ||
          !HANDLER_METHODS.test(callee.property.name)
        ) {
          return;
        }

        // Discriminate on call SHAPE, not on the object's name: a route registration is
        // a string-literal path plus at least one handler argument. Matching router-ish
        // identifiers instead would exempt a router named `v1Router` — silently, which
        // is the failure this rule exists to prevent.
        const [firstArgument, ...restArguments] = node.arguments;
        const literalPath =
          firstArgument?.type === 'Literal' && typeof firstArgument.value === 'string'
            ? firstArgument.value
            : null;

        // `router.route('/x').get(h).post(h2)` carries the path on the .route() call, so
        // each chained method sees only a handler. Walk back down the chain to find it —
        // stopping at the first link would leave every method after .get() unchecked.
        let chainedPath = null;
        for (let link = callee.object; link?.type === 'CallExpression'; link = link.callee.object) {
          if (
            link.callee.type !== 'MemberExpression' ||
            link.callee.property.type !== 'Identifier'
          ) {
            break;
          }
          if (
            link.callee.property.name === 'route' &&
            link.arguments[0]?.type === 'Literal' &&
            typeof link.arguments[0].value === 'string'
          ) {
            chainedPath = link.arguments[0].value;
            break;
          }
        }

        const path = literalPath ?? chainedPath;
        const handlerCount = literalPath ? restArguments.length : node.arguments.length;
        if (path === null || handlerCount === 0) {
          return;
        }

        // JSDoc attaches to the enclosing statement, not the call — and the statement is
        // not always the direct parent (`export default router.get(...)`, an assignment,
        // or a `.route('/x').get(...)` chain all nest it deeper).
        let statement = node;
        while (statement.parent && !/Statement|Declaration/.test(statement.parent.type)) {
          statement = statement.parent;
        }
        const target = statement.parent ?? statement;

        // One JSDoc block documents one operation. In a `.route('/x').get().post()`
        // chain every link shares the same preceding comment, so only the innermost may
        // claim it — otherwise a single block silences every method after the first.
        const isInnermostLink =
          callee.object.type !== 'CallExpression' ||
          callee.object.callee.type !== 'MemberExpression' ||
          callee.object.callee.property.type !== 'Identifier' ||
          !HANDLER_METHODS.test(callee.object.callee.property.name);

        const hasTag =
          isInnermostLink &&
          sourceCode
            .getCommentsBefore(target)
            .some(
              (comment) =>
                comment.type === 'Block' &&
                OPENAPI_BLOCK.test(comment.value) &&
                hasAnnotationBody(comment.value),
            );

        if (hasTag) {
          return;
        }

        context.report({
          node: target,
          messageId: 'missingOpenapiTag',
          data: {
            method: callee.property.name.toUpperCase(),
            path,
          },
        });
      },
    };
  },
};

export default requireOpenapiTag;
