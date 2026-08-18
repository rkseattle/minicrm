/**
 * Custom ESLint rule: require-locator-fallback
 *
 * Enforces that every page.locate() call provides at least two strategies in
 * its strategies array. A single-strategy locate has no recovery surface when
 * the primary strategy fails — the healing framework exhausts immediately
 * instead of trying alternatives.
 *
 * Documented exception: dynamic ID locators (e.g. `deal-card-${id}`) that
 * have no stable role-based alternative may use a single testId strategy, but
 * must add an inline comment explaining why:
 *
 *   // single-strategy: no stable role alternative for dynamic deal-card ID
 *   page.locate([{ type: 'testId', value: `deal-card-${id}` }], { intent: '...' })
 *
 * This rule does NOT enforce the comment — it enforces the two-strategy
 * minimum. To opt out, use eslint-disable-next-line with a justification.
 *
 *
 */

/** @type {import('eslint').Rule.RuleModule} */
const requireLocatorFallback = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require at least two strategies in every page.locate() call so the healing ' +
        'framework has a fallback when the primary strategy fails.',
      recommended: false,
    },
    schema: [],
    messages: {
      singleStrategy:
        'page.locate() has only one strategy. Add a fallback (role, label, text, or css) ' +
        'so the healing framework can recover when the primary strategy fails. ' +
        'If a stable fallback truly does not exist (e.g. dynamic ID with no role), ' +
        'add eslint-disable-next-line with a justification comment. ' +
        'See MINCRM-313.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        const { callee, arguments: args } = node;

        // Match: page.locate(...) or this.page.locate(...)
        if (callee.type !== 'MemberExpression') return;
        if (callee.computed) return;
        if (callee.property.type !== 'Identifier') return;
        if (callee.property.name !== 'locate') return;

        const obj = callee.object;
        const isPageLocate =
          (obj.type === 'Identifier' && obj.name === 'page') ||
          (obj.type === 'MemberExpression' &&
            !obj.computed &&
            obj.property.type === 'Identifier' &&
            obj.property.name === 'page');

        if (!isPageLocate) return;

        // First argument must be an array literal with >= 2 elements.
        const strategiesArg = args[0];
        if (!strategiesArg) return;
        if (strategiesArg.type !== 'ArrayExpression') return;

        if (strategiesArg.elements.length < 2) {
          context.report({ node, messageId: 'singleStrategy' });
        }
      },
    };
  },
};

export default requireLocatorFallback;
