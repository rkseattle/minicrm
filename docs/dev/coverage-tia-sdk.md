# Coverage/TIA Agent & Harness Adapter SDK

The plugin/SDK architecture MINCRM-636 calls for: a versioned contract plus one real
reference implementation of each half (agent, harness adapter), so a new language or
test framework can be added by implementing `CoverageAgentPlugin`/providing a
`HarnessAdapterShape`-equivalent client, without changing the pipeline/mapping/
selection layers' own logic. See [docs/dev/coverage.md](coverage.md) for the framework
this SDK plugs into.

**Scope of "no core changes":** implementing the `CoverageAgentPlugin` interface and
registering an instance requires no change to `coverageAgentRegistry.ts` or any
pipeline/mapping/selection code — that part is genuinely open. Persisting a new
agent's dumps into `coverage_units` under their own `agent` value, however, DOES
require a schema change: `coverage_units.agent`/`CoverageDump.agent` are the closed
`CoverageDumpSource` union (`'node-v8' | 'browser-istanbul'`), backed by a real DB
`CHECK` constraint (`qa/migrations/001_coverage_baseline.js`) that per-tier reporting
depends on staying closed. A new agent's own `AgentMetadata.id` is a free-form string
with no such constraint (useful immediately for logging/registry identity), but
widening `CoverageDumpSource` itself — and the reporting/symbolication code that
switches on it — is a deliberate, separate, out-of-scope migration-level change, not
something this SDK phase does speculatively for a language that doesn't exist yet.

## Why a versioned interface, not a plugin loader

There is exactly one language agent (`NodeV8CoverageAgent`, Node/V8) and one harness
(Playwright, via the E2E reference clients) in this repo today. A dynamic
directory-scanning or manifest-based plugin loader would have no second real plugin to
validate it against — its own bugs would be invisible until a real second
implementation existed. This SDK instead follows the repo's own established
precedent for a single-consumer extension point (`TestScorer`,
`server/src/coverageAgent/testSelection/scorer.ts` — a compile-time interface with one
default implementation, injected by the caller): ship the contract and the one real
implementation, document how a second implementation plugs in, and defer loader/
registry machinery until a second implementation actually needs it.

## Adding a new language agent

Implement `CoverageAgentPlugin` (`server/src/coverageAgent/sdk/CoverageAgentPlugin.ts`):

```ts
import type {
  AgentMetadata,
  CoverageAgentPlugin,
  CoverageDump,
} from './sdk/CoverageAgentPlugin.js';

const MY_AGENT_METADATA: AgentMetadata = {
  id: 'my-language-id', // free-form — no CoverageDumpSource change needed for the metadata itself
  language: 'My Language',
  displayName: 'My Language Coverage Agent',
};

export class MyLanguageCoverageAgent implements CoverageAgentPlugin {
  readonly metadata = MY_AGENT_METADATA;

  async reset(): Promise<void> {
    /* clear accumulated counters */
  }
  // CoverageDump.agent/format below are still the closed CoverageDumpSource/
  // CoverageDumpFormat unions — a real new agent whose dumps must reach
  // coverage_units needs a schema change to widen coverage_units_agent_check
  // first (see "Scope of 'no core changes'" above); this stub compiles by
  // reusing an existing value, not by widening the union speculatively.
  async snapshot(label: string): Promise<CoverageDump> {
    /* read without full persist */
  }
  async dump(label: string): Promise<CoverageDump> {
    /* persist a tagged artifact */
  }
}
```

Register the instance at boot the same way `server.ts` registers
`NodeV8CoverageAgent` today:

```ts
import { registerCoverageAgent } from './coverageAgent/coverageAgentRegistry.js';
registerCoverageAgent(new MyLanguageCoverageAgent(options));
```

`coverageAgentRegistry` is typed to the `CoverageAgentPlugin` interface, not the
concrete `NodeV8CoverageAgent` class, specifically so this registration compiles for
any conforming implementation.

Document your agent's own reset-on-read semantics (or lack of them) in your
implementation's docblock — `NodeV8CoverageAgent`'s own `snapshot()` caveat
(V8's `takePreciseCoverage()` clears counters as a side effect of reading them, so
`snapshot()` is not truly non-destructive) is agent-specific behavior the SDK contract
itself does not — and cannot — guarantee uniformly across languages.

## Adding a new harness adapter

The harness-adapter contract is `HarnessAdapterShape<TClient>`
(`shared/schemas/coverageHarnessAdapterSchema.ts`) — real function signatures, generic
over the underlying HTTP client type, not prose. A new harness integration's client
module can be checked against it directly:

```ts
import type { HarnessAdapterShape } from '@shared/schemas/coverageHarnessAdapterSchema.js';
import type { MyHarnessClient } from './my-harness-client.js';

export const myHarnessAdapter: HarnessAdapterShape<MyHarnessClient> = {
  startSession: startMyHarnessCoverageSession,
  endSession: endMyHarnessCoverageSession,
  recordDump: recordMyHarnessCoverageSessionDump,
  injectCorrelationHeader: (headers, correlationId) => {
    headers[CORRELATION_ID_HEADER] = correlationId;
  },
};
```

The Playwright reference implementation satisfies this shape structurally (same
signatures, same session/dump wire types from `coverageSessionSchema.ts`) without
declaring an explicit `HarnessAdapterShape` object of its own —
`qa/e2e/framework/coverageAgent/coverage-session-control-client.ts`'s five exported
functions map onto it as:

| `HarnessAdapterShape` member | Playwright reference implementation                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `startSession`               | `startCoverageSession` (`coverage-session-control-client.ts`)                                                        |
| `endSession`                 | `endCoverageSession`                                                                                                 |
| `recordDump`                 | `recordCoverageSessionDump`                                                                                          |
| `injectCorrelationHeader`    | `page.context().setExtraHTTPHeaders({ [CORRELATION_ID_HEADER]: correlationId })` (`qa/e2e/apps/minicrm/fixtures.ts`) |

This is enforced as a real `satisfies HarnessAdapterShape<RestClient>` assertion —
`qa/e2e/tests/framework/coverage-session-control-client.spec.ts`'s
`_playwrightHarnessAdapterCheck` — not just documented in this table. That assertion
lives outside `qa/e2e/framework/` deliberately: `framework/` itself must stay free of
`shared/schemas/` (app-domain) imports, so the compile-time check that ties the two
together lives in the spec file that already imports and exercises this client, one
layer up. `tsc --noEmit --workspace=minicrm-qa` fails if either side's signature drifts
from the other. `docs/dev/coverage.md`'s correlation-ID/session-management sections
remain the source of truth for the session control API itself
(`/api/v1/admin/coverage/sessions/*`) — no harness-specific server-side code is
required to add a new harness once its adapter follows this shape.

## SDK versioning policy

This SDK is pre-1.0 and internal-only (`SDK_VERSION` in `CoverageAgentPlugin.ts`). It
has no external package consumers to protect, so there is no formal semver release
process — a breaking change to `CoverageAgentPlugin`, `AgentMetadata`, or
`HarnessAdapterShape` is recorded as a dated entry in this document (below) and bumps
`SDK_VERSION`, rather than triggering a major-version-bump/deprecation-window process.

### Changelog

- **0.1.0** (MINCRM-636) — Initial formalization. Promoted the existing
  `CoverageAgent` interface (MINCRM-604/606) into `sdk/CoverageAgentPlugin.ts`, added
  `AgentMetadata`, documented `HarnessAdapterShape` against the existing Playwright
  reference client's shape.
