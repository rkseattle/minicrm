// Hand-written because the module is untyped .mjs and its TypeScript importer
// (scripts/strip-work-item-ids.ts, under tsconfig.scripts.json's "strict": true with
// no allowJs) raises TS7016 on a bare .mjs import. TypeScript pairs .mjs with .d.mts
// specifically; a .d.ts beside it does not resolve.
export declare const WORK_ITEM_ID: RegExp;
export declare const SUPPRESSION_MARKER: RegExp;
export declare const OPENAPI_BLOCK: RegExp;
export declare function isExemptComment(commentValue: string): boolean;
export declare function reportableWorkItemIds(commentValue: string): string[];
