/**
 * Assertions that a doc-parity guard's ci.yml wiring is intact.
 *
 * A guard of this kind has two halves, and only one of them is visible in the guard's
 * own assertions: the paths-filter output that decides when its job runs, and the OR
 * clause in that job's `if:` that consults the output. Delete either and the guard stops
 * running on the edit it exists to catch, while every one of its own tests still passes —
 * silence being the failure mode the guards were written against in the first place.
 *
 * Deliberately kept free of DB and app imports so a guard that only reads files does not
 * pull a pool in through a helper.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';

const REPO_ROOT = join(__dirname, '../../..');
export const WORKFLOW = '.github/workflows/ci.yml';

function workflowText(): string {
  return readFileSync(join(REPO_ROOT, WORKFLOW), 'utf8');
}

/** Job and output names interpolate into patterns; a metacharacter would alter the match. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The paths a filter output lists.
 *
 * Comments interleave the entries, so a pattern matching only entry lines stops at the
 * first comment and silently drops everything after it.
 *
 * @param output - The filter output name, e.g. `feature-flag-docs`.
 * @returns The quoted paths, in file order.
 */
function filterPaths(output: string): string[] {
  // Entries and their interleaved comments share one indent; the next output's name sits
  // shallower. Accepting a comment at any indent runs past the end of this block into the
  // next output's leading comment, and takes its entries too once one follows.
  const block = new RegExp(
    `\\n( +)${escapeRegExp(output)}:\\n((?:\\1  (?:- '[^']+'|#[^\\n]*)\\n|\\n)+)`,
  ).exec(workflowText());
  expect(block, `${WORKFLOW} must declare a ${output} filter output`).not.toBeNull();
  return [...block![2].matchAll(/- '([^']+)'/g)].map((match) => match[1]);
}

/**
 * A job's `if:` expression, block-scalar or single-line.
 *
 * Both scans stop at the next job header. An unbounded scan walks past a job that has no
 * `if:` into the next one that does and returns its condition — so asserting against a
 * job with no gate reads some unrelated job's, and passes whenever that one happens to
 * name the output.
 */
function jobCondition(job: string): string {
  const NEXT_JOB = '(?:(?!\\n  \\w).*\\n)*?';
  const text = workflowText();
  expect(
    new RegExp(`\\n  ${escapeRegExp(job)}:\\n`).test(text),
    `${WORKFLOW} must define a ${job} job`,
  ).toBe(true);

  const block = new RegExp(
    `\\n  ${escapeRegExp(job)}:\\n${NEXT_JOB}    if: *\\|?\\n?((?:(?!\\n  \\w).*\\n)*?)    \\w`,
  ).exec(text);
  expect(
    block,
    `${WORKFLOW} job ${job} has no if: condition, so it cannot gate on a filter output.`,
  ).not.toBeNull();
  return block![1];
}

/**
 * Asserts a job consults every filter output declared for it.
 *
 * The declaration and the OR clause are separate edits, and only the declaration is
 * visible to check-ci-filter-globs.mjs. Removing a clause leaves the output declared,
 * every guard's own tests passing, and the guard unrun on the paths it names.
 *
 * @param job - The job whose `if:` gates these outputs.
 * @param outputs - Filter output names that must appear in that condition.
 */
export function expectJobGatesOn(job: string, outputs: readonly string[]): void {
  const condition = jobCondition(job);
  for (const output of outputs) {
    expect(
      condition,
      `${WORKFLOW} job ${job} no longer gates on needs.changes.outputs.${output}. The ` +
        'filter output is still declared, so nothing else reports that the guard it ' +
        'triggers has stopped running.',
    ).toContain(`needs.changes.outputs.${output}`);
  }
}

/**
 * Asserts both halves of a guard's trigger: the filter output lists exactly the files the
 * guard reads, and the job that runs it consults that output.
 *
 * @param options.output - Filter output name in ci.yml.
 * @param options.job - Job whose `if:` must reference the output.
 * @param options.filesRead - Every repo-relative path the guard reads.
 */
export function expectGuardIsTriggered(options: {
  output: string;
  job: string;
  filesRead: readonly string[];
}): void {
  const { output, job, filesRead } = options;
  const listed = new Set(filterPaths(output));

  for (const file of filesRead) {
    expect(listed, `${WORKFLOW} ${output} must list ${file}, which the guard reads`).toContain(
      file,
    );
  }
  // The other direction: a listed path the guard never reads boots the job to assert
  // nothing, and hides that the entry was meant for a check that no longer exists.
  for (const path of listed) {
    expect(
      new Set(filesRead),
      `${WORKFLOW} ${output} lists ${path}, which the guard never reads`,
    ).toContain(path);
  }

  // Declaring the output is not enough: without the OR clause the job never consults it.
  expect(
    jobCondition(job),
    `${WORKFLOW} job ${job} must gate on needs.changes.outputs.${output}, or the ` +
      `${output} filter is declared but never consulted and the guard stops running.`,
  ).toContain(`needs.changes.outputs.${output}`);
}
