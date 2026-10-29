# Rule-book exceptions

MiniCRM's register of waived "must" rules, in the format defined by the delivery kit's
`gates/exceptions.md`. An expired row is remediated or renewed with a new expiry in a commit
that says why it still holds.

| Rule                                             | Reason                                                                                                                                                                                                                                                         | Risk                                                       | Expiry     | Remediation                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------- | -------------------------------------------------------------- |
| ci-green Step 5: approving review (rule book R2) | No reviewer is configured for this solo-maintained repository; each PR gets a blind adversarial review per phase, a cold branch review, and Greptile's review, with every finding answered, and the tech lead approved this exception for PR #425 (MINCRM-581) | A defect only a second human would catch merges unreviewed | 2027-01-27 | At expiry, renew, or name a reviewer in `.claude/project.json` |
