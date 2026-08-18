// Hand-written because the rule is untyped .mjs and the importing project —
// coverage-dashboard, whose tsconfig raises TS7016 on a bare .mjs import — runs with
// "strict": true and no allowJs. TypeScript pairs .mjs with .d.mts specifically; a
// .d.ts beside it does not resolve.
declare const rule: import('eslint').Rule.RuleModule;
export default rule;
