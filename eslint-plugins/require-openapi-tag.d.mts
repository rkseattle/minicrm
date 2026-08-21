// Hand-written for the same reason as no-work-item-id-in-comment.d.mts: the rule is
// untyped .mjs and coverage-dashboard's tsconfig raises TS7016 on a bare .mjs import.
// TypeScript pairs .mjs with .d.mts specifically; a .d.ts beside it does not resolve.
declare const rule: import('eslint').Rule.RuleModule;
export default rule;
