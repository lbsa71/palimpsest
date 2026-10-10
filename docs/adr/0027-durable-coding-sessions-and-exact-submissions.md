# ADR 0027: Durable coding sessions and exact submissions

- **Status:** Implemented bounded host contract; deterministic receiver and serving evidence available. Production provider packaging, configured-model acceptance and installation remain pending.
- **Recorded:** 2026-10-10.
- **Requirements:** R03, R06, R14, R17–R19, R22–R26; P17.3/P17.4.
- **Specification:** [Durable coding session](../work-items/p17-durable-coding-session.md), with [serving implementation and evidence](../work-items/p17-serving-coding.md).

## Context

The selected native adapter and isolated tools do not give the serving agent a
durable coding workflow. A permanently running foreground coding task blocks
the background scheduler; a separate empty budget ledger would grant additional
capacity. Importing a publication checkout would also lose inherited admitted
source, while a file-only proposal cannot preserve arbitrary complete trees.

## Decision

Keep Palimpsest-owned `coding-session/1` records in the existing Store, independent
of SDK classes and the unchanged executable-plan single-call contract. Seal the
origin, objective, source artifact, workspace/base, provider profile, tool catalog,
finite policy and report route. Give execution a separate internal task source
and revalidate current authority at receiver boundaries. Retain raw responses,
intents, operation identities and actual receipts separately from compact model
history. Unknown requests and command outcomes remain spent and unreplayed.

Reserve each physical model request transactionally against its existing
conversation, plan-authoring or shared growth/reflection lane. Link a previously
charged conversation or independent agenda decision once into cumulative limits
without another window debit. Retain fair background selection across reopen and
allocation windows. Expiry mechanically ends even a session with no wake time;
drain owned commands before declaring it ended. Execution permission and the
permission to report a terminal disposition are separate.

Use the existing trusted collector to select the actual admitted source, then
independently verify its complete bytes, modes, directories and root identity.
Persist that source before asynchronous collection, and preserve it across
recovery. Import only this verified tree into the external draft workspace.
The trusted layout port preserves empty directories and their modes; these are
source metadata, not model authority over host paths.

Submit an immutable `coding-submission/1` artifact with the complete resulting
tree, original/current bases, session provenance and actual command receipts.
Only a lossless representation compatible with the unchanged cognitive parser
and freezer may enter the existing proposal queue. Its bridge includes inherited
admitted cognitive blobs that differ from the historical Git base. Unsupported
trees and formats remain intact as `awaiting_supported_admission`; this is a
draft disposition, not activation or release approval.

Retain an owed outcome in the originating scope before acknowledging admission.
Bind deferred topic reports to their revision and source exchange, so an older
execution cannot overwrite a newer conversation outcome. An unavailable source
or provider produces an honest retained disposition without an invented session
grant. Prepared, delivered and uncertain reports remain distinct. Shared status
contains only session identity, state and phase; model text, source and output
belong to the authorized originating result path.

The serving hook and provider factory are explicit injection interfaces. The
CLI has no configured production coding factory yet. Keep the selected SDK's
synthetic serving witness in its experiment, outside the normal dependency-free
test set; production retained dependency environments remain separate P18 work.

## Alternatives and consequences

- A foreground task reuses familiar state but can block its own scheduler.
- A new independent budget counter grants capacity beyond existing policy.
- SDK-owned durable sessions couple authority and recovery to provider state.
- Git checkout import or a changed-file-only bridge loses admitted source.
- Broader admission added in the same step would mix authoring mechanics with
  unimplemented environment and governance transitions. Preserve drafts now and
  keep the required autonomous activation routes explicit in P18.

This adds a journal and source artifact lifecycle while reusing existing task,
effect, worker, filesystem and communications receivers. Actual synthetic
transport witnesses exercise feedback and repair through admitted workers; they
do not establish model competence, production dependency resolution, public
security or a deployed coding capability. Current command restrictions and
unknown-owner recovery gaps remain documented in the workspace specifications.
