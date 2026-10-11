# A1-L08-T02 native Claude kernel proof

2026-10-11. Owner `/root/a1_claude_kernel`, isolated worktree `/home/palimpsest/migration/aeon-1-20261011/claude-kernel`, branch `codex/a1-claude-kernel-20261011`, base `01b978f`. Exclusive writes: new `evaluations/baselines/claude-kernel.test.ts` and this evidence. An actual finite goal was created without a token budget. Root owns integration, final source freeze, the serialized physical window and fresh independent review.

```text
/goal Complete finite A1-L08 native Claude kernel engineering proof with bounded actual kernel-resource observations, isolated test and evidence, or document concrete failed limitation.
```

**Draft: physical execution has not occurred.** The prepared test uses the existing `runClaudeBaseline` → shared native runner → `runWorker` → `spawnBounded` path. It adds no runtime harness, dependency, codec, grant mechanism or shared enforcement change. [Claude transport evidence](claude-transport-fixture.md), [its fresh review](claude-transport-review.md), [Codex kernel evidence](baseline-kernel.md), [its review](baseline-kernel-review.md), and [live profile readiness](live-profile-readiness.md) remain distinct inputs. A skipped opt-in test is not kernel evidence.

## Frozen behavioral specification

The only proposed claim is actual native Claude CLI and Bash composition under the existing kernel enforcement with synthetic Messages replies. The public downloaded Claude 2.1.296 binary is `/home/palimpsest/migration/aeon-1-20261011/claude-native-feasibility/claude-2.1.296`, SHA-256 `24972e3bc859fab2b46ed4c1e51f7d6130f06d3bd550811a114640de3370d0de`. Node is `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`, v24.13.0. These are fixture inputs; no account or provider network is used.

The declared profile stays `anthropic-fixture`, Haiku fixture model, low effort, Bash only, thinking disabled and explicit zero synthetic prices. The original grant stays two requests, 400,040 reserved tokens, one synthetic USD, 30,000 ms total, concurrency one, and 10,000 ms per request. A completed synthetic attempt must settle exactly 100 input tokens, 10 output tokens and zero USD. None of these values establishes a first-party live contract, entitlement, model competence or best-system configuration.

The existing administrator provisioner creates a new 16 MiB ext4 volume with 128 inodes, UID 1006/GID 1008. A disposable delegated service runs the trusted observer in its host leaf. Native worker, Claude and Bash descendants must share one command group with 768 MiB memory, zero swap, OOM group kill, 96 tasks, CPU quota/period 50,000/100,000 microseconds, 2 MiB file ceiling and 256 file descriptors. The service envelope is 2 GiB, zero swap, 256 tasks, 200% CPU, 75 seconds and whole-group termination.

The first synthetic response asks genuine Bash to run Python that observes PID creation refusal (`EAGAIN`), performs a touched allocation and CPU work, fills blocks then inodes until both refuse with `ENOSPC`, removes its probe files, verifies private evaluator/state/backing image and actual provider credentials are hidden, checks cgroup controls are absent, verifies its actual file/fd limits, observes external socket refusal, and writes `proof.txt`.

The host independently samples the running Python process, Claude and worker from the command group's actual `cgroup.procs` and `/proc`; tool and CLI cgroup membership must match. The second captured native Messages request must contain every terminal tool marker before the second response is returned. Host readback requires exact configured resource ceilings, positive PID-limit and CPU-throttling events, bounded memory peak, fixed ext4 capacity and inode count, correct proof and unchanged private sentinel.

Both durable attempts and physical requests must be completed/settled, native system/messages/tools unchanged by accounting, the original grant and allocation unchanged, cancellation preserved, and replay refused without dispatch. Native completion must leave no command cgroups. The external trap will stop the disposable service, remove the mounted volume using the existing administrator provisioner and verify no unit, processes/groups, mount, loop association or volume remains, including on failure.

## Execution and acceptance record

Pending root source freeze and serialized physical execution. The exact frozen source, commands, results, failures, durable artifact identities, external evidence index and cleanup observations will be recorded here after that window. No strict final check or native execution is claimed by this draft.

## Scope limits

No deliberate OOM is planned; existing aggregate OOM evidence remains separate. The whole read-only `/usr` tool set is unsealed and trusted stable host paths are assumed. The full Claude tool/delegation/recovery configuration, first-party high-effort profile compatibility, cache/tier/media/thinking accounting and live provider access remain separate gates. This finite proof cannot establish paid execution, calibration, parity, full L08 acceptance or H1. No credentials, paid/account request, Slack/message, push, production operation or dependency change is authorized here.
