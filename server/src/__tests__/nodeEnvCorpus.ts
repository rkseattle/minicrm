/**
 * NODE_ENV values the safeguards must reject, shared by the two files that test them.
 *
 * nodeEnv.test.ts asserts the predicates return the production posture for each;
 * appEnvGating.test.ts asserts the gates actually stay closed for the same set.
 * A value covered in one but not the other is the gap where a predicate is proven
 * safe while the gate it drives is not, so the corpus has one home.
 */

/** Unset, empty, misspelled, differently cased, and simply unknown. */
export const UNRECOGNIZED_ENVS: ReadonlyArray<[string, string | undefined]> = [
  ['unset', undefined],
  ['empty', ''],
  ['misspelled', 'producton'],
  ['differently cased', 'Production'],
  ['unknown', 'qa-box'],
];

/** Every value the safeguards accept. */
export const RECOGNIZED_ENVS = ['development', 'test', 'staging', 'production'] as const;
