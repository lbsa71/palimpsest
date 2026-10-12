# Schema source metadata integration

2026-10-12. Root narrow DI26 subtask, owned metadata/evidence only; exact claim d01e099. Read-only source from DI06a f7db5dc. No auditor, upstream identity, license, fixture or acceptance behavior changes.

```text
/goal Regenerate exact retained schema source metadata from verified pinned upstream bytes, prove the complete local patch reconstructs the new retained closure under the unchanged auditor, and hand off only two metadata files plus evidence for independent review.
```

Precode: copy all eight original retained files from claim d01e099 to temporary public-source staging; reverse the complete original local.patch using the existing patch executable; require every reconstructed byte hash equals its pinned upstreamSha256. Derive a fresh unified patch from those verified sources to the exact new eight-file retained closure. Update only changed retainedSha256 entries and add a truthful patch description. Apply the fresh patch to an independent copy of the verified upstream and byte-compare every result with new retained source. Run unchanged audit-source.mjs including reconstructed upstream root and all original retained official fixture checks. Failures are evidence, not grounds to change auditor or pins. No network/download/install needed.

All eight baseline retained hashes and reconstructed pinned upstream hashes matched. Staged upstream is `/tmp/palimpsest-schema-upstream-71fp0zaj`; every full-patch reconstruction equals exact retained bytes. Only dereference.ts and validator.ts retained hashes change; all other pins remain identical. Existing unchanged auditor passes with upstream verification:8 files,1,720 lines,53,977 bytes, zero external runtime imports,14 fixture files/373 official assertions. Command: `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node packages/narrow-schema/audit-source.mjs /tmp/palimpsest-schema-upstream-71fp0zaj`; log `/tmp/aeon-schema-di-source-audit.log`.

Initial generated three-context-line patch passed roundtrip/auditor but `git diff --check` flagged two added patch context lines containing only the mandatory space marker. Regenerated as a standard zero-context unified patch to avoid encoding trailing whitespace in the artifact, then reapplied to an independent upstream copy: all8 exact byte matches again. No source or auditor altered. Final diff passes. The fresh DI06a reviewer receives this exact metadata join; other DI26 scripts and later Pi changes remain separate.
