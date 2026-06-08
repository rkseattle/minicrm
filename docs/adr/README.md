# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for MiniCRM. ADRs capture
significant architectural decisions: the context that motivated the decision, the decision
itself, and the consequences — both intended and accepted tradeoffs.

## Format

Each ADR follows the Nygard template:

- **Status** — `Accepted`, `Deprecated`, `Superseded by ADR-NNN`
- **Context** — the forces at play; the problem being solved
- **Decision** — the change adopted
- **Consequences** — what becomes easier, what becomes harder, what is accepted as a tradeoff

## Index

| ADR                                       | Title                                                    | Status   |
| ----------------------------------------- | -------------------------------------------------------- | -------- |
| [001](001-single-org-no-multi-tenancy.md) | Single-org deployment — no multi-tenancy                 | Accepted |
| [002](002-custom-fields-eav-vs-jsonb.md)  | Custom fields: EAV storage with documented query ceiling | Accepted |

## Guidelines

- Create a new ADR for any decision that: affects the database schema in a cross-cutting
  way, introduces or removes a major dependency, changes a security or compliance posture,
  or that future developers will likely question.
- Number sequentially. Never renumber existing ADRs.
- Superseded decisions keep their file; add a **Status** update and a link to the
  superseding ADR rather than deleting or rewriting.
- Reference ADRs from CLAUDE.md, migration comments, and PR descriptions when the decision
  directly influences the code being written.
