/**
 * Custom ESLint rule: require-locator-intent
 *
 * Enforces that every page.locate() call in page object files carries a
 * non-empty `intent` string as the second argument's `intent` property.
 * The AI healing tier (AiHealer) is only activated when `intent` is present —
 * without it, StrategyExhaustedError fires immediately instead of attempting
 * AI-assisted recovery.
 *
 * Valid forms:
 *   page.locate([...], { intent: 'some description' })
 *   this.page.locate([...], { intent: 'some description' })
 *
 * Invalid (triggers rule):
 *   page.locate([...])                            // no second arg
 *   page.locate([...], {})                        // intent missing
 *   page.locate([...], { intent: '' })            // intent empty string
 *   page.locate([...], { fallbackTimeout: 500 })  // intent absent
 *
 * MINCRM-309
 */

/** @type {import('eslint').Rule.RuleModule} */
const requireLocatorIntent = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a non-empty `intent` string on every page.locate() call in page objects. ' +
        'The AiHealer tier only activates when intent is present.',
      recommended: false,
    },
    schema: [],
    messages: {
      missingIntent:
        'page.locate() is missing a non-empty `intent` string. ' +
        'Add { intent: "5-10 word description" } as the second argument so the AI healing ' +
        'tier can recover when static strategies are exhausted. ' +
        'See MINCRM-309.',
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

        // Must have a second argument that is an object literal with a
        // non-empty string `intent` property.
        const optionsArg = args[1];

        if (!optionsArg) {
          context.report({ node, messageId: 'missingIntent' });
          return;
        }

        if (optionsArg.type !== 'ObjectExpression') {
          // Second arg exists but is not an object literal — cannot statically
          // verify intent; report to require explicit object form.
          context.report({ node, messageId: 'missingIntent' });
          return;
        }

        const intentProp = optionsArg.properties.find(
          (p) =>
            p.type === 'Property' &&
            !p.computed &&
            p.key.type === 'Identifier' &&
            p.key.name === 'intent',
        );

        if (!intentProp) {
          context.report({ node, messageId: 'missingIntent' });
          return;
        }

        // intent must be a non-empty string literal or a non-empty template literal
        const v = intentProp.value;
        const isNonEmptyStringLiteral =
          v.type === 'Literal' &&
          typeof v.value === 'string' &&
          v.value.trim() !== '';
        // A TemplateLiteral is always considered non-empty — static analysis
        // cannot evaluate runtime values, and a template literal always produces
        // a string (even if the interpolated value is empty at runtime, the
        // intent of the author is clearly present).
        const isTemplateLiteral = v.type === 'TemplateLiteral';

        if (!isNonEmptyStringLiteral && !isTemplateLiteral) {
          context.report({ node, messageId: 'missingIntent' });
        }
      },
    };
  },
};

export default requireLocatorIntent;
