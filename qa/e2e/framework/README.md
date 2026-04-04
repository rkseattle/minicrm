# framework/

Product-agnostic framework code. **Must contain zero application-domain references.**

This directory will house:

- `HealingLocator` — self-healing UI locator with CSS/ARIA/AI fallback tiers (S2, S3)
- `LocatorRegistry` — stores locator strategies per element (S2)
- Playwright fixtures — base fixture wiring (S4)
- REST API client (S5)
- gRPC client (S6)
- `HealingReporter` — custom Playwright reporter that emits `healing-report.json` (S2)

A CI lint step (`check-framework-purity.sh`) greps this directory for application-domain
strings and fails the build if any are found.
