/**
 * Custom ESLint rule: no-work-item-id-in-comment
 *
 * Rejects Jira work-item IDs in source comments. They belong in commit messages,
 * PR titles, and branch names, where git blame keeps them accurate; in a comment
 * they point at a system the reader usually cannot resolve and go stale silently.
 * State the reason inline instead.
 *
 * Invalid:  // Kept under MAX_SAFE_INTEGER so pg can bind it (MINCRM-NNN)
 * Valid:    // Kept under MAX_SAFE_INTEGER so pg can bind it
 *
 * Two exemptions:
 *   - `-ok:` suppression markers. The exact spelling
 *     is matched by qa/scripts/check-e2e-cleanup.sh and check-e2e-beforeall.sh, so
 *     the token is an API rather than a reference for the reader.
 *   - `@openapi` blocks, which swagger.ts compiles into the served API document.
 *     Editing them changes published contract text, not commentary.
 *
 * Only comment tokens are inspected, so string literals holding an issue key as
 * data — the Coverage/TIA feature stores them — are untouched.
 */

import { isExemptComment, reportableWorkItemIds } from './work-item-id-patterns.mjs';

/** @type {import('eslint').Rule.RuleModule} */
const noWorkItemIdInComment = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow work-item IDs in source comments',
      recommended: false,
    },
    schema: [],
    messages: {
      workItemIdInComment:
        'Work-item ID {{ id }} in a comment. Put the reason in the comment and the ID ' +
        'in the commit message — git blame carries the linkage without going stale.',
    },
  },

  create(context) {
    return {
      'Program:exit'() {
        for (const comment of context.sourceCode.getAllComments()) {
          // Contract text, exempt as a whole: the tag governs everything under it.
          if (isExemptComment(comment.value)) {
            continue;
          }

          // Every other exemption is per-occurrence, not per-comment. A `-ok:` marker
          // exempts itself and nothing else, so an unrelated ID sharing its comment
          // is still reported.
          const found = reportableWorkItemIds(comment.value);
          if (found.length === 0) {
            continue;
          }

          context.report({
            node: comment,
            messageId: 'workItemIdInComment',
            data: { id: found[0] },
          });
        }
      },
    };
  },
};

export default noWorkItemIdInComment;
