# ADR 0028: Prepared Linux candidate isolation

- **Status:** Accepted bounded migration prerequisite; source and actual target
  checks recorded in the [work item](../work-items/linux-candidate-isolation.md).
  Destination installation, copied-state recovery and actual sealed service
  worker confinement now pass the bounded [migration gate](../migration-acceptance-2026-10-10.md).
  Cross-kernel compatibility and hard resource quotas remain outside this evidence.
- **Recorded:** 2026-10-10.
- **Requirements:** R17–R19, P05; refinement of [ADR 0009](0009-local-enforcement-and-recovery.md).

## Context and decision

The explicitly requested move to Ubuntu cannot use macOS Seatbelt. Ordinary
subprocesses or namespaces alone do not preserve candidate executable, process
and filesystem restrictions. Keep the existing trusted job/session interfaces
and use required Bubblewrap namespaces plus a separately prepared native helper.
The helper establishes recursive noexec source/scratch mounts and removes all
capabilities, then installs exact executable Landlock rules, scratch write rules,
`no_new_privs` and architecture-checked seccomp before candidate execution.
Missing preparation or enforcement
fails closed. V8 threads remain available; process creation requires the existing
trusted exception, and namespace/session/group escape remains denied.

Bind helper source, ELF and build-receipt hashes in each new Linux runtime
manifest. Hash roles independently of absolute roots so sealed relocation keeps
identity. Compile only during trusted packaging; keep the C source in Git and
ignore exactly the binary/receipt roles. The service independently checks and
seals those native extras with the admitted candidate. A matching mutable receipt
alone does not establish admission or build provenance.

Custody names the outer Bubblewrap monitor. Reconstruct its exact trusted worker
descriptor from the retained artifact, launch ID, scope and read exclusions.
Stopping requires verified group identity and actual group absence. If the
monitor has already vanished, only independently observed group absence permits
retirement; an unverified remaining group is held without signalling it. Worker
completion errors remain errors at the stop boundary.

## Alternatives and consequences

Namespaces alone leave readable or writable candidate ELF executable. Landlock
execute restrictions alone can be bypassed by an admitted ELF interpreter;
recursive noexec candidate mounts close that path. Blanket noexec runtime-library
mounts prevent the dynamic linker from booting Node. Necessary fixed read-only
libraries remain executable through the interpreter, an explicit trusted-native
visibility limit. This design does not provide CPU, RSS or scratch-disk quotas,
protection from hostile same-account administrators, or a universal Linux ABI.

An unconfined fallback would silently remove the existing contract and is
rejected. A VM or general syscall broker adds substantially different packaging
and operation requirements; it is not needed for this bounded x86-64 migration.
Kernel/platform changes require renewed actual evidence. Source review, primitive
tests and startup are distinct from copied-state recovery and service acceptance.
