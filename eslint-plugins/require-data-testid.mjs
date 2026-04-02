/**
 * Custom ESLint rule: require-data-testid
 *
 * Enforces that interactable JSX elements have a `data-testid` attribute.
 * Elements with a JSX spread attribute are skipped because the testid may be
 * forwarded via props (e.g. reusable Button/Input/Select wrappers).
 *
 * Covered elements: button, a, input, select, textarea
 */

/** @type {import('eslint').Rule.RuleModule} */
const requireDataTestid = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require data-testid on interactable JSX elements',
      recommended: false,
    },
    schema: [],
    messages: {
      missingTestId:
        '<{{ elementName }}> is missing a data-testid attribute. ' +
        'Every interactable element must have a unique data-testid for E2E selectors.',
    },
  },

  create(context) {
    const INTERACTABLE_ELEMENTS = new Set(['button', 'a', 'input', 'select', 'textarea']);

    return {
      JSXOpeningElement(node) {
        // Only native HTML elements (lowercase names)
        const elementName =
          node.name.type === 'JSXIdentifier' ? node.name.name : null;

        if (!elementName || !INTERACTABLE_ELEMENTS.has(elementName)) {
          return;
        }

        // Skip elements that use a spread — data-testid may be forwarded via props
        const hasSpread = node.attributes.some(
          (attribute) => attribute.type === 'JSXSpreadAttribute',
        );
        if (hasSpread) {
          return;
        }

        const hasTestId = node.attributes.some(
          (attribute) =>
            attribute.type === 'JSXAttribute' &&
            attribute.name.type === 'JSXIdentifier' &&
            attribute.name.name === 'data-testid',
        );

        if (!hasTestId) {
          context.report({ node, messageId: 'missingTestId', data: { elementName } });
        }
      },
    };
  },
};

export default requireDataTestid;
