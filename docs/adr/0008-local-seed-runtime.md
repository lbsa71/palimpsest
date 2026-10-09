# ADR 0008: Local TypeScript seed, direct communications, external state

- **Status:** Accepted for the first implementation slice.
- **Recorded:** 2026-10-08.
- **Requirements:** R04–R07, R17–R19; P01–P06.

**Subsequent scope refinement, 2026-10-09:** [ADR 0019](0019-coding-autonomy-and-reusable-agent-plumbing.md) replaces the framework-free restriction below to meet explicit basic coding and full-codebase autonomy requirements. P17.1 selected a pinned direct Mistral adapter behind a replaceable/forkable host facade from isolated fixture evidence; production integration remains pending. The original minimal-runtime choice and its historical verification remain recorded here.

## Context

The user requested implementation, regular pushes, and a locally executed self-improvement iteration that produces a Palimpsest-originated pushed change. The user also explicitly requested a communications-provider abstraction for direct testing and required lived-experience substrate outside the repository.

This checkout runs on macOS arm64 with Node 24.13.0, npm 11.6.2, and an authenticated Codex CLI 0.146.1. Node's bundled SQLite 3.50.4 was exercised in memory. Docker is installed but its daemon is unavailable. These are observed local development capabilities, not a settled production host specification. Mistral and Slack credentials were absent from the process environment at inspection.

## Decision

Use TypeScript with Node 24's native type stripping, its built-in test runner, and `node:sqlite` for this local seed. Use TypeScript and Node types only as development dependencies, with a lockfile. Keep runtime imports free of a general agent framework. Node currently labels SQLite experimental; pin the supported Node major and test upgrades before use.

Use one SQLite database with separate tables for operational truth, developmental memory, and the standing growth agenda. This retains conceptual boundaries without introducing cross-store delivery for the seed. Memvid remains an evaluated future option, not an unverified dependency.

Communications are adapters around shared ingress and task state. A direct callable adapter and authenticated loopback API make local testing possible. Slack implements the same transport boundary; no test needs to send a real Slack message.

Mistral remains the default inference adapter. An explicitly selected Codex subprocess adapter supports local development and independent review using the existing login. Provider/model choices are visible configuration; missing credentials never trigger fallback. Credentials live in `~/.config/palimpsest/credentials.env`, not Git or chat. No model identifier is invented from older research; live configuration must be validated against the selected provider.

All lived experience and runtime data live outside the checkout, by default `~/.local/share/palimpsest/<repository-id>/`. This includes memory, tasks, events, agendas, checkpoints, transcripts, lineage, and candidate-run records. Reject paths inside the repository, including symlink aliases. Code, synthetic fixtures, specifications, and sanitized verification summaries belong in Git. A source `GROWTH.md` defines behavior; the live growth agenda is external state.

## Consequences and remaining work

This resolves the seed language, basic persistence, and direct-test interface. It does not by itself prove process isolation, live Mistral or Slack integration, governed self-modification, or production recovery. [ADR 0009](0009-local-enforcement-and-recovery.md) records the subsequent real macOS isolation checks. Live integrations and complete succession remain required plan work.

Reference: [Node SQLite API](https://nodejs.org/api/sqlite.html), [Mistral chat API](https://docs.mistral.ai/api/endpoint/chat), [Codex non-interactive execution](https://developers.openai.com/codex/noninteractive/). Integration behavior must be verified against the installed/configured versions.
