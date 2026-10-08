# ADR 0001: Preserve the self-evolving companion scope

- **Status:** Accepted direction; implementation stack remains open.
- **Recorded:** 2026-10-08.
- **Source:** The synthesis and user's “best of both worlds” response in the [source analysis](../research/source-analysis.md).

## Context

The colleague's brief describes a narrower assistant: a VPN chat website, local-model/Rust choices, mandatory protected supervisor responsibilities, and no unrequested improvement loop. The original attachment was separately recovered and read in full after the thread response returned only its attachment marker. The thread tool returned six turns; earlier turns and the assistant-generated packages remain unavailable. Palimpsest's described ambition is broader: a companion with personality, human-inspired memory, initiative, and eventual control over its evolving environment.

## Direction

Keep Slack as the primary interaction channel, with communication continuing while work runs. Use Mistral-first inference with explicitly configurable alternatives. Start with a small understandable seed and preserve broad self-modification as the long-term objective. Adopt engineering safeguards from the other design without inheriting its narrower product scope.

Do not assume Rust, a local-model-only setup, a mandatory Codex teacher, a website-first interface, or a permanently human-maintained cognitive supervisor. TypeScript is an earlier proposal, not a completed stack decision. Memvid remains a candidate to evaluate.

## Consequences and follow-up

Provider adapters and runtime boundaries must permit evolution without silent fallback or provider lock-in. Strong recovery must coexist with autonomy rather than concentrating all intelligence in a permanently frozen supervisor. Temporary chat remains optional and would need accurately scoped retention guarantees. Select the seed language, runtime, and storage through later evidence-backed decisions.

See [architecture](../architecture.md) and [requirements](../../REQUIREMENTS.md).
