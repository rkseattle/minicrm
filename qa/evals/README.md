# MiniCRM NLI Eval Suite

Promptfoo-based evaluation framework for the MiniCRM Natural Language Interface (NLI).
Validates tool selection, response quality, RBAC enforcement, and PII minimization.

## Quick Start

```bash
# Install dependencies (once)
npm install

# Set the API key (required for LLM-as-judge suites)
export ANTHROPIC_API_KEY=your-key-here

# Run the full suite
npm run eval
```

Results are written to `qa/evals/.output/results.json` (gitignored).

## Test Files

| File                | Concern                                                                 | Assertion type                                |
| ------------------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| `nli-intent.yaml`   | Tool selection for unambiguous queries                                  | Deterministic — `javascript` equality check   |
| `nli-semantic.yaml` | Response relevance and non-hallucination                                | LLM-as-judge — Haiku `llm-rubric`             |
| `nli-rbac.yaml`     | Admin-only tools absent from rep tool set; unauthorized-op error format | Mixed — `not-contains` + Haiku `llm-rubric`   |
| `nli-pii.yaml`      | PII fields absent from AI payloads; `pii_excluded` custom fields nulled | Deterministic — `not-contains` + `javascript` |

## Model Selection Rationale

**`claude-haiku-4-5-20251001` for LLM-as-judge assertions (`nli-semantic.yaml`, part of `nli-rbac.yaml`):**
Haiku is cost-effective for binary pass/fail rubrics where the judgment is straightforward
("does the response address the query?", "does it contain only information from the tool results?").
Rubrics are kept narrow and binary — vague rubrics produce inconsistent judgments and inflate
rerun variance.

**Deterministic assertions for structure and PII (`nli-intent.yaml`, `nli-pii.yaml`, RBAC tool list):**
`is-json`, `not-contains`, and `javascript` assertions are used wherever the correctness
criterion is structural. These run without any API call and produce identical results
across every run.

**PII assertions MUST NEVER use an LLM judge.** Routing a PII check through a judge model
sends the PII value (e.g., an SSN) to the Anthropic API as part of the judge's prompt.
Use `not-contains` or `javascript` for all PII checks.

## Pass/Fail Thresholds

| Suite               | Threshold       | Rationale                                                                                   |
| ------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `nli-intent.yaml`   | 100% (implicit) | Deterministic assertions — any failure is a regression                                      |
| `nli-semantic.yaml` | 90%             | Allows up to 10% Haiku judgment variance on binary rubrics                                  |
| `nli-rbac.yaml`     | 90%             | Deterministic tool-list checks are 100% by construction; 90% covers Haiku error-format test |
| `nli-pii.yaml`      | 100% (implicit) | Deterministic assertions — any failure is a PII leak                                        |

The 90% threshold for Haiku-judged suites is a practical floor, not a quality target.
If a rubric is well-written, Haiku should pass consistently. A persistent failure rate
above 10% indicates the rubric needs narrowing.

## Fixtures

`fixtures/crm-data.json` provides a self-contained dataset used across all suites:

- **3 contacts:** Alice Chen, Bob Martinez, Carol Singh
  - Carol Singh includes two `pii_excluded: true` custom fields (SSN, bank account number)
- **2 accounts:** Acme Corp, Beta LLC
- **1 deal:** Acme Enterprise Contract (open, Enterprise pipeline, proposal stage)
- **1 lead:** David Park

Pre-shaped `tool_results` entries under the `tool_results` key provide ready-to-inject
context for each eval scenario. Tests are fully self-contained — no live DB or HTTP server
is required.

## Adding Test Cases

1. **New tool selection scenario** — add a test block to `nli-intent.yaml` with a
   `javascript` assertion that parses the output and checks `parsed.tool === '<expected_tool_name>'`.
   Do not use `is-json` with a `value:` object — promptfoo treats that value as a JSON Schema
   (validated by AJV), not an equality target, and AJV throws on unknown keywords.

2. **New semantic quality scenario** — add a test block to `nli-semantic.yaml` with a
   narrow binary `llm-rubric`. Keep the rubric to 2–3 sentences.

3. **New RBAC rule** — if a new admin-only tool is added to `server/src/ai/tools/adminTools.ts`,
   add a `not-contains` assertion for its name in `nli-rbac.yaml`.

4. **New PII field** — if a new field is added to `ALWAYS_EXCLUDED_FIELDS` in
   `server/src/ai/piiFilter.ts`, add a `not-contains` assertion in `nli-pii.yaml`.
   Never use `llm-rubric` for PII assertions.

## Environment Variables

| Variable            | Required                | Purpose                                                       |
| ------------------- | ----------------------- | ------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | For Haiku-judged suites | LLM-as-judge calls in `nli-semantic.yaml` and `nli-rbac.yaml` |

Copy `qa/evals/.env.example` to `qa/evals/.env` and fill in your key. The `.env` file
is gitignored.

## CI Integration

The `ai-evals` job in `.github/workflows/ci.yml` runs `npm run eval` automatically when
changed files match `server/src/ai/**`, `qa/evals/**`, or `.github/workflows/ci.yml`.
Results are uploaded as a CI artifact for post-run inspection. See MINCRM-569 for details.
