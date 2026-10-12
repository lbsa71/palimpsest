# DI09 storage environmental composition

Owner `/root/a1_environment_storage`; branch `codex/a1-environment-di-09-20261012`; base `3fe646f`. Governing inputs: AGENTS, REQUIREMENTS RW10/RW16/RW19, workflow, A1-L03, adopted DI plan and DI01. Exclusive writes: storage index, new storage environment, new deployment DI09 test, this evidence. Existing source/tests are read-only. Finite tool goal created before implementation.

```text
/goal Complete DI09 storage filesystem, synchronous SQLite and ID injection in its four claimed paths, preserve transaction/journal/source/fence behavior, record serial focused regression and strict evidence, and hand off a clean exact commit for independent review.
```

## Behavioral precode (frozen before source changes)

Keep OperationalStore's existing domain surface and production constructor facade. Add optional second `StorageEnvironment` argument. Narrow local ports: `id(): string`; `exists(path): boolean`; `realpath(path): string`; `mkdir(path, {recursive:true,mode:number}): void`; `openDatabase(filename): StorageDatabase`. SQLite handle exposes only `exec(sql)`, `prepare(sql)` and `close()`; statement exposes positional `get`, `all`, `run` with native SQLite bind values/result types. Capture each supplied callback once before filesystem/DB/ID callbacks. Call receiver-free functions; production composition alone binds native receivers. Capture returned DB/statement methods at acquisition so later caller mutation cannot redirect work. No singleton/container/import effects or environmental fallback after a supplied failure.

Preserve exact physical-path containment (including symlink aliases/missing descendants), mkdir mode, SQL schema/PRAGMA busy_timeout/WAL/FULL/foreign_keys, transaction/savepoints, CAS, retained journal version/anchor/mutation identity and withdrawal, bounded preflight/page/artifact/current-use/owner read fences. IDs remain nonempty domain strings (no UUID-only constraint exists). Failed ID/statement operations roll back actual document/event/internal journal writes. A supplied DB is owned only after successful open; constructor failure closes it once. Keep open diagnostic cause; if rollback/close also fails, retain every exact thrown value and primary cause instead of masking it. Normal close failure propagates. No claim that a failed cleanup succeeded. Failed rollback leaves transaction state uncertain: prevent further reads/writes until close, while depth/latches are restored; a successful rollback permits subsequent/nested sibling transactions. Commit failure triggers rollback; no retry or success fabrication. Begin/savepoint setup failure must not increment depth.

Meaningful new cases before implementation: receiver-free capture/selector mutation and two-instance isolation; simulated physical checkout/mkdir and IO/open failures; schema/commit/rollback/close failure ownership; single and simultaneous operation/cleanup errors including non-Error throws; failed nested release/rollback with outer restoration; deterministic anchor/version/mutation supplier failures and duplicates with real SQLite rollback/reopen; real WAL/FULL/CAS/savepoint/journal/withdrawal and fence regressions. Fakes demonstrate mechanics only, never live provenance.

## Existing test inventory before execution

All twelve storage test files were inspected for case declarations and process/network launches. They have no child/process/listener calls; all are controlled in-process SQLite. Existing prototype interception measures forbidden/bounded SQL operations and remains unchanged/read-only. Exact files and cases follow (loop expressions retain their finite expansions in source):

### `packages/storage/test/development-historical-fence-review.test.ts`

- test('review: failed inner ordinary transaction restores the exact two-level source state'
- test('review: then accessor throws under the fence and restoration survives an outer rollback'
- test('review: exact prefix rejects a later same-key version substituted for the accepted old version'
- test('review: failure in a second source releases the first fence and preserves outer transaction writes'

### `packages/storage/test/development-historical-fence.test.ts`

- test('nested historical use releases its fence before ordinary memory writes and preserves the committed cut'
- test('historical guard rejects every supported mutation, close and development reentry, even when caught'
- for (const result of ['throw', 'promise', 'object-thenable', 'function-thenable'] as const) test(`historical ${result} refusal unwinds only its savepoint and restores the write fence`
- test('outer rollback discards uncommitted suffix despite successful call-local historical observation'
- test('uncommitted withdrawal denies conservatively without retaining a capture or committed attestation'
- for (const roleId of ['candidate', 'control'] as const) test(`actual ${roleId} runtime reserve/dispatch composes with all-role historical gates and releases before receiver writes`

### `packages/storage/test/development-owner-read-fence.test.ts`

- test('owner read-only fence supports nested ordinary read transactions without journal metadata'
- test('every public owner mutation and close refuses before changing stored bytes'
- test('owner read-only fence refuses reentry and restores ordinary writes after a throw'
- for (const kind of ['object', 'function'] as const) test(`owner read-only fence refuses ${kind} thenables without invoking then`

### `packages/storage/test/development-pages-acceptance.test.ts`

- for (const field of ['id', 'stream', 'type', 'data'] as const) test(`supported R3 ${field} byte overflow rejects before marker materialization`
- for (const field of ['id', 'stream', 'type', 'data'] as const) test(`supported R3 ${field} BLOB storage rejects before marker materialization`
- for (const sequence of ['0', '-1', '9007199254740992'] as const) test(`supported R3 unsafe/nonpositive sequence ${sequence} rejects before marker materialization`
- for (const budget of ['exact', 'raw-minus-one', 'conservative-minus-one'] as const) test(`supported R3 genuine Unicode/NUL marker at ${budget} budgets`
- for (const overflow of ['version-marker-product', 'prefix-index-product', 'page-hard-ceiling'] as const) test(`supported R3 existing ${overflow} refuses without a marker read`
- for (const mode of ['forget', 'expiry'] as const) test(`supported memory ${mode} revokes old source/derived/self refs after legitimate accounting growth`

### `packages/storage/test/development-pages.test.ts`

- t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, query: string) { if (/^SELECT (CAST\(namespace AS BLOB\)|CAST\(id AS BLOB\)|sequence,CAST\(id AS BLOB\)|namespace,key,revision,value|sequence,id,stream,type,data|key,revision,value|revision,CAST\(value AS BLOB\)|revision,value|key,value|sequence,stream,type,data)/.test(query)) reads.push(query); return original.call(this, query); });
- test('complete pages include all physical internals and exact intermediate graph/global row chains'
- test('paged path never invokes full document/event/snapshot validation helpers'
- test('historical graph supports many initial anchor refs within its byte and version budgets'
- test('row chain does not depend on page boundaries and document order uses SQLite BINARY UTF-8'
- for (const variant of ['rows', 'aggregate', 'singleton', 'pages', 'overflow'] as const) test(`${variant} capacity refusal does not materialize row values`
- for (const variant of ['document-blob', 'event-blob', 'revision-real', 'invalid-utf8', 'noncanonical'] as const) test(`${variant} physical representation refuses honestly`
- test('fragmentation-induced page overflow is preflighted before any value SELECT'
- for (const variant of ['missing-payload', 'orphan-payload', 'orphan-head', 'head-value', 'event-gap', 'event-ref', 'reserved'] as const) test(`${variant} graph corruption rejects`
- test('valid withdrawal retains complete structural pages but old exact versions become unavailable'
- test('bounded withdrawal marker read preserves Unicode and embedded NUL identity bytes'
- for (const field of ['id', 'stream', 'type', 'data', 'aggregate', 'sequence'] as const) test(`R3 ${field} selected marker overflow refuses before marker materialization`
- for (const field of ['id', 'stream', 'type', 'data'] as const) test(`R3 ${field} malformed marker storage refuses before marker materialization`
- test('R3 exact selected marker budgets permit Unicode/NUL and one byte less refuses before read'
- for (const variant of ['marker-missing', 'marker-forged', 'payload-forged', 'orphan-withdrawal'] as const) test(`${variant} withdrawal fails corruption rather than usable history`
- test('historical old deleted/replaced versions survive accounting growth while exact-current-cut refuses'
- test('historical input clones only bounded known fields and yields an immutable call-local observation'
- for (const variant of ['payload-missing', 'payload-corrupt', 'prefix-changed', 'ref-forged', 'scope-duplicate', 'prefix-bytes', 'version-bytes', 'marker-bytes'] as const) test(`${variant} historical read rejects before callback`
- for (const operation of ['put', 'delete', 'append', 'artifact', 'withdraw', 'close', 'capture', 'full-capture', 'async', 'substitute', 'mutate-bytes'] as const) test(`${operation} callback cannot invalidate capture transaction`
- test('both fences reject callback writes, reentrancy and asynchronous results and release on failure'
- test('a caught nested source write leaves the successful source fence unchanged'
- test('a concurrent descriptor writer cannot interleave with a retained page'
- test('operational artifacts resolve on the actual open handle after pathname rename'
- test('scalar artifact freshness reads the actual connection without materializing stored bytes'
- test('exact URI scope distinguishes source and authorized retained originals with identical bytes'
- for (const variant of ['missing', 'corrupt', 'singleton', 'aggregate', 'count', 'external-substitute', 'external-async', 'external-write'] as const) test(`${variant} operational artifact refuses`
- for (const mode of ['separate-conversations', 'same-message-revisions'] as const) test(`actual application complete pages cover twelve offline admissions: ${mode}`

### `packages/storage/test/document-journal-review.test.ts`

- for (const reserved of ['document-mutation', 'document-journal-anchor']) for (const fault of ['data-getter', 'type-getter'] as const) test(`generic append cannot forge ${reserved} through ${fault} side effects`
- test('committed transitions remain reconstructable through delete/recreate, stale CAS and caught event failure'
- test('capture retains actual open connection when its directory symlink is replaced'
- test('preflight rejects UTF8, escaped event metadata, BLOB and row excess before value reads'
- if (/^SELECT (?:\*|namespace,key,revision,value|key,revision,value|sequence,stream,type,data) FROM (?:documents|events)/.test(sql)) payloadReads++;
- test('gaps, erased tail and high-water corruption refuse instead of certifying shortened history'
- test('fresh and existing handles refuse missing or corrupt journal metadata without changing documents'
- test('actual application binds before initial allocation and omitted-option reopen retains its anchor'

### `packages/storage/test/document-journal.test.ts`

- test('one atomic anchor preserves initial rows and every intermediate update, deletion and recreation'
- test('CAS and JSON serialization refusal create neither new document state nor journal records'
- test('SQLite journal INSERT failure rolls back actual put and delete while preserving committed history'
- test('SQLite document SQL failure cannot publish a mutation event'
- test('outer rollback removes nested documents and events; a caught savepoint failure leaves valid sibling writes'
- test('durable binding is honored by reopen and handles opened before activation, without constructor options'
- test('explicit disable and contradictory stream, host or bounds refuse on reopen and stale disabled writers'
- test('generic mutation cannot change/delete reserved binding or forge journal events'
- test('changed or deleted durable metadata and missing anchor refuse further writes and reopen'
- test('anchor row and UTF8 byte ceilings refuse before row materialization and leave no partial binding'
- test('anchor INSERT or binding INSERT failure rolls back activation, leaving ordinary state unchanged'
- test('snapshot contains exact global events and all current documents, through deletion and reopen'
- test('snapshot invalid, zero, row and Unicode byte ceilings refuse before materializing values'
- test('snapshot preflight and materialization hold the same transaction against real competing writes'
- test('snapshot rejects corrupt JSON and oversized raw sources rather than returning partial evidence'
- test('ordinary unbound stores keep ordinary event/document behavior and report null journal completeness'
- test('fresh omitted-option reopen refuses changed persisted anchor ceilings'
- test('snapshot refuses missing internal or trailing events before materializing a partial prefix'
- test('snapshot corrupt event JSON refuses while empty ordinary snapshot remains complete'
- test('invalid host anchor options refuse without persisting a partial anchor'
- test('ordinary accessor inputs retain stable event identity across payload serialization and deduplication'
- test('payload accessor serialization failure rolls back its nested document side effects'

### `packages/storage/test/journal-retention-review.test.ts`

- test('independent cutoff preserves equal-byte owners, immutable prefix and future recreated incarnations'
- for (const fault of ['second-payload', 'marker'] as const) test(`independent ${fault} failure restores partial SQL work and caught savepoint permits sibling commit`
- for (const fault of ['orphan', 'ref-extra', 'current-digest', 'marker-id', 'marker-target', 'marker-reason', 'available-again', 'missing-head', 'reserved-row', 'prefix'] as const) test(`independent capture rejects ${fault} corruption`
- test('independent byte and row preflight includes hidden payloads before bulk selects and keeps hard ceilings'
- t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) { if (/^SELECT (namespace,key,revision,value|key,revision,value|key,value|\*) FROM/.test(sql)) bulk++; return prepare.call(this, sql); });
- test('independent anchor and cutoff use SQLite BINARY key order across unicode namespaces'
- for (const bound of [false, true]) test(`repair rejects unknown reserved inventory before binding acceptance: bound=${bound}`
- for (const namespace of [META, PAYLOAD, HEAD]) test(`repair preserves wrong-key rejection for known metadata namespace ${namespace}`
- test('repair BINARY prefix check preserves ordinary namespace case and literal lookalikes'

### `packages/storage/test/journal-retention.test.ts`

- test('withdrawal preserves immutable refs, isolates equal bytes, and cannot hydrate old refs from later versions'
- for (const failure of ['payload', 'marker'] as const) test(`actual ${failure} SQL failure rolls back all dispositions and leaves current payloads usable`
- test('outer and caught savepoint rollback preserve withdrawal identity, visibility and sibling writes'
- test('activation payloads can be withdrawn and preexisting handles never rehydrate their withdrawn before refs'
- for (const fault of ['missing', 'commitment', 'withdrawn-without-marker', 'wrong-marker', 'reordered', 'head'] as const) test(`snapshot rejects ${fault} ref/payload corruption rather than inferring erasure`
- test('all reserved namespaces and withdrawal event type refuse generic writes including mutable caller input'
- test('capture counts payload/head rows and UTF8 bytes before materialization; activation counts prospective internal rows'
- t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) { if (/^SELECT (namespace,key,revision,value|key,revision,value|\*) FROM/.test(sql)) reads++; return original.call(this, sql); });
- test('v1 journals refuse explicitly without rewriting historical rows, while unbound withdrawal validates CAS and creates nothing'
- test('UTF8 binary ordering agrees across activation, target sorting and replay for BMP and supplementary keys'
- test('withdrawal input serialization failure rolls back its document side effects inside the store transaction'

### `packages/storage/test/storage-bounds-review.test.ts`

- if (/SELECT\s+bytes\s+FROM\s+artifacts/i.test(sql)) blobsSelected++;
- test('bound uses UTF-8 BLOB byte count, permits exact zero and rejects foreign references before allocation'
- test('actual TEXT and integer storage classes are rejected before selecting even apparently small values'
- test('same-size corrupted BLOB still fails hash authentication after bounded selection'
- test('nested caller transaction preserves lock through size check and BLOB access'
- if (/SELECT\s+bytes\s+FROM\s+artifacts/i.test(sql)) {

### `packages/storage/test/storage-bounds.test.ts`

- test('oversized and nonempty zero-byte bounds reject before SQLite selects the BLOB'
- test('exact and empty bounds retain hash validation and ordinary unbounded behavior'
- test('invalid finite integer bounds fail without querying or allocating artifact bytes'
- test('missing and invalid artifacts preserve failure without BLOB allocation'
- test('bounded actual BLOB read still rejects corrupted bytes'
- test('Unicode TEXT corruption cannot underreport physical byte length before BLOB selection'
- test('bounded length and bytes reads hold one synchronous write lock against a competing update'

### `packages/storage/test/storage.test.ts`

- test('atomic projection/event rollback, CAS and reopened artifacts'
- test('checkout state and asynchronous transactions are refused'
- test('retained capture gate excludes outer and nested uncommitted state through rollback'
- test('dot-dot named checkout children and symlink aliases are rejected'
- test('incompatible and partially forged schemas produce open diagnostics'

Excluded separate physical recovery gate: `packages/runtime/test/recovery-composition.test.ts` spawns the recovery fixture and kills/restarts processes. Product lifecycle, supervisor/service/installation, native/provider/Slack/network and full benchmark suites are outside this finite scope. Process/crash proof remains an integration gate, not represented by in-process reopen.

Planned serial checks with pinned `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`: new DI09 test; explicit twelve storage files; exact DI03 author/reviewer plus selected owner-current-use tests after launch inspection; strict `node node_modules/typescript/bin/tsc --noEmit`; diff and exact path checks. No broad test runner, push or deploy. Dependencies supplied by ignored node_modules symlink to main checkout only.

## Results and downstream handoff

Implemented and fixture-verified authored DI09 slice; independent acceptance remains pending. Precode commit `12bdc1b` predates every source mutation. Named `createNodeStorageEnvironment()` is inert on construction/import and creates actual Node filesystem/SQLite adapters only when invoked. `OperationalStore(options, environment?)` captures the five receiver-free callbacks before host callbacks, detaches returned SQLite/statement methods, and uses genuine ECMAScript private fields for ID, raw rollback and uncertain transaction state. Existing own-field integrity checks remain unchanged. Pure supplied-byte hashing/path operations remain pure.

Successful rollback retains exact primary failure identity and permits subsequent use. A failed rollback preserves primary plus cleanup in AggregateError/cause; uncertainty blocks subsequent SQL until close or confirmed enclosing full rollback. Outer cleanup uses the captured raw exec even when an inner rollback made the handle uncertain. A late error after actual COMMIT cannot claim rollback: the rollback failure is retained, the open handle refuses further use, and reopen exposes the committed bytes. Constructor acquired handles close exactly once on failure; open/mkdir/filesystem failures acquire no database. Single close failure propagates; a failed close is neither swallowed nor represented as success. Duplicate generated journal version IDs reject using scalar SELECT 1 before overwrite or payload materialization. Caller-authored event/withdrawal IDs keep their original surface and domain validations.

### Commands and observations

Every check ran serially with `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node` (v24.13.0), source base `3fe646f`, and only the ignored `node_modules` symlink to `/home/palimpsest/src/palimpsest/node_modules`; no install or dependency changes. SQLite emits its normal experimental warning. Exact reproducible commands:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 deployment/environment-di-09.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 packages/storage/test/storage.test.ts packages/storage/test/storage-bounds.test.ts packages/storage/test/storage-bounds-review.test.ts packages/storage/test/document-journal.test.ts packages/storage/test/document-journal-review.test.ts packages/storage/test/journal-retention.test.ts packages/storage/test/journal-retention-review.test.ts packages/storage/test/development-pages.test.ts packages/storage/test/development-pages-acceptance.test.ts packages/storage/test/development-historical-fence.test.ts packages/storage/test/development-historical-fence-review.test.ts packages/storage/test/development-owner-read-fence.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 deployment/environment-di-03.test.ts deployment/environment-di-03-review.test.ts evaluations/development/current-use-owner-fence.test.ts evaluations/development/current-use-owner-fence-review.test.ts
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

- Final new checks: 35/35 pass, exit 0; zero skips/cancellations. Expanded final source test log `/tmp/environment-di09-new-expanded.log`. Earlier 31/31 also passed. New cases cover captured selector mutation/options aliases, independent stores, injected filesystem containment/failures, constructor pragma/begin/commit/prepare/get/all/ID diagnosis and ownership, primary/rollback/close double/triple failures (non-Error values included), close retry, begin/commit depth recovery, failed rollback/uncertain use, nested setup/release/rollback and sibling restoration, generated version/mutation/empty/collision failures, statement run failure, retained history, real factory alias/WAL/FULL/CAS/locking/reopen, source bounds/read-owner fences/withdrawal, failed activation with existing state, no unbound ID consumption, and error after actual COMMIT.
- Final unchanged storage: 197/199 pass, exit 1, zero skips/cancellations; exact log `/tmp/environment-di09-old-storage-expanded.log`. All core mechanism, scalar/bounded reads, page/marker preflight, journal retention/withdrawal, savepoints, source/owner fences and the same-message-revisions application case pass. Two unchanged application fixture failures remain; details below.
- Selected unchanged downstream: 50/50 pass, exit 0, zero skips/cancellations; `/tmp/environment-di09-downstream.log`. These four files were enumerated and inspected for process/network launches before running; no such calls exist. Case inventory: DI03 author 16 and reviewer 12 (exact named/finite loop cases listed in their source), current-use owner author 13 and reviewer 9 (snapshot/paged profiles; owner/custodian/original/captured-source write and reentry refusals, nested read restoration, provider-promise boundary with no real requests, guard-entry withdrawal durability, hostile thenable/exception/custodian-destruction exits, and exact outer rollback). All prior test bytes unchanged.
- Strict compile: exit 0 before new tests, after first corrected tests/private-field repair, and after expanded final tests. Diff whitespace check: exit 0. No broad build/full benchmark or external effect ran. An evidence-only trailing blank-line diff-check refusal was corrected before final whitespace verification.

### Preserved failures and diagnosis

Initial new test run: 7/31 pass, 24 fail, exit 1. All 24 failures were new fixture teardown errors `ERR_INVALID_STATE: database is not open`: the helper attempted native close after already confirmed test/constructor close. Failed case set: independent captured instances; statement capture; seven constructor pragma/begin/commit/prepare/get/all/journal-ID variants; close retry; two BEGIN/COMMIT variants; failed rollback; two nested savepoint/release variants; nested rollback recovery; five version/mutation/empty/duplicate-version/duplicate-event variants; statement run rollback; named Node real mechanism; retained cut/withdrawal. Corrected only new test cleanup to check actual `DatabaseSync.isOpen`; removed the duplicate after-hook close in named Node case. No source/old assertion/cap change was used to make these pass.

First unchanged storage run: 196/199 pass, exit 1, log `/tmp/environment-di09-old-storage.log`. Three failures were `Exact operational Store without extensions required`: separate-conversations application pages, same-message-revisions application pages, and application journal binding/reopen. New TypeScript private fields were enumerable and violated the existing exact own-field integrity check in read-only `deployment/development-controls.ts:30`. Replaced only new fields with ECMAScript private fields in owned storage. The integrity check itself is unchanged.

After that correction: 197/199 pass, exit 1, `/tmp/environment-di09-old-storage-final.log`; final expanded-source repeat stays 197/199. Remaining exact failures:

1. `packages/storage/test/development-pages.test.ts:311`, `actual application complete pages cover twelve offline admissions: separate-conversations`: at line327 actual physicalRows603 versus expected551. Capacity gates/predicate unchanged; samples already cease full snapshot capture at admission7 versus old expected8 (second assertion is not reached). This is additional durable elapsed-floor journal state under already joined DI03, not dropped source rows.
2. `packages/storage/test/document-journal-review.test.ts:130`, `actual application binds before initial allocation and omitted-option reopen retains its anchor`: at line147 compares the FIRST allocation mutation payload (revision1/floor0) to the current allocation (revision2/floor5), before close/reopen. Application construction allocates `initiative:ordinary` under the operating envelope (`application.ts:229`), and accepted DI03 `ResourceLedger.allocate(parent)` now persists ancestor elapsed floor (`resources/index.ts:48`). The assertion ignores the later legitimate allocation mutation in the same journal. Reopen assertion line150 is not reached; no reopen failure is inferred. Baseline used floor6; final author repeats floor5 (wall-dependent). Journal binding/anchor/provenance remain intact.

Both failures were reproduced using exact original `git show 3fe646f:packages/storage/index.ts` bytes temporarily in the sole owned source path, with all other source/tests unchanged, and restoration in Python finally before further work. Exact positively anchored command:

```sh
/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node --test --test-concurrency=1 --test-name-pattern='^(actual application complete pages cover twelve offline admissions: separate-conversations|actual application binds before initial allocation and omitted-option reopen retains its anchor)$' packages/storage/test/development-pages.test.ts packages/storage/test/document-journal-review.test.ts
```

Baseline result 0/2, exit1, zero skips, `/tmp/environment-di09-baseline-app.log`: same603/551 and revision1/floor0 versus revision2/floor6. No baseline physical launch or caller override. These remain explicit root DI27 fixture/integration gates; this author does not broaden write ownership, hide them with skip/negative selectors, or replace their expectations.

### Exact downstream wiring and limitations

DI14 owns `deployment/application.ts`. Add a host-only optional `storageEnvironment?: StorageEnvironment` to ApplicationOptions; eagerly capture its exact five callback identities before config/authority/caller callbacks, retain that captured object in the existing frozen constructor-option selection, and pass it as the second argument at the OperationalStore call currently line88. Production roots may omit it (named Node constructor facade) or compose `createNodeStorageEnvironment()` once. Broker uses the application Store, so no new broker Store constructor is required. Keep IDs/files/database ports out of serialized configuration, model tools/prompts/C1/candidate input; an injected handle grants no live/source authority or operational ceiling increase. Root DI27 must separately claim the exact two prior fixture cases above after accounting semantics review. No existing test/source outside the four claim paths was changed.

DI10/13/16/18/22 consumers may use the exported structural StorageDatabase/StorageStatement types only when the required operations genuinely match; native custody/process/authority adapters remain their own scope. DI28 still audits actual final active closure, and fresh DI09 review remains required. No live evidence, host process/crash/native confinement/provider/tokenizer/model competence/Slack recovery/H1/whole-DI/deployment acceptance is claimed. Historical real process/crash proof must be rejoined under its separate authorized physical gate. This finite authored goal finishes on clean four-path handoff without waiting for review.
