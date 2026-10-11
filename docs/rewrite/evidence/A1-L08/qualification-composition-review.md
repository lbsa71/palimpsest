# A1-L08/L09 qualification composition fixture review

Status: fixture correction verified, 2026-10-11. Owner: `/root/a1_qualification_fixture`, delegated fresh review of root's aggregate failure and the already integrated coding-fixture repair. Base: `1909053`; branch `codex/a1-qualification-fixture-review-20261011`; isolated worktree `/home/palimpsest/migration/aeon-1-20261011/qualification-fixture-review`. Exclusive changes: `evaluations/qualification/composition.test.ts` and this record. Root retains integration and final acceptance.

```text
/goal Diagnose and correct the aggregate synthetic qualification composition failure while preserving actual qualification behavior, resource accounting, private checks and admission boundaries; verify the exact opt-in case and hand off bounded evidence.
```

## Finding and disposition

The preserved aggregate at `ea5e4453a810dd6ed66bf5017bdeb17b532cb01a` finished with 641 tests, 633 passes, one failure and seven skips in 395758.825 ms. Its composition diagnostic records six successful model requests, six tool effects including explicit delivered speech, two successful private arithmetic checks and objective quality 3. The actual application nevertheless ended **blocked**, and the original adapter verdict was **criterion-unmet**. The seventh synthetic response is the explicit model `stop` after `speech_send`; accepting six calls would hide incomplete termination.

The composition test freezes its own deployment inputs. Unlike the already corrected `fixtureConfiguration` in `evaluations/product/fixture.ts`, it still configured a 1,024-token output allowance. `deployment/broker-shell.ts` reserves conservative input bytes plus 1,024 framing tokens and the configured output allowance before dispatch; `packages/runtime/resources/index.ts` checks that reservation plus settled prior consumption against the grant. The enlarged ordinary tool transcript therefore matters even though each synthetic response declares only 100 input and 20 output tokens.

Align this synthetic configuration to the existing 256-token coding-fixture output allowance. The 30,000-token operating grant, 64-request ceiling, zero-dollar ceiling, 60-second deadline, concurrency, original issued-at time and synthetic declared usage are unchanged. Production profiles, payload accounting, observer and release conversion are unchanged. The callback now records payload byte counts as bounded diagnostics. Preserve seven-call, private-leakage, private-command, original-ledger, cancellation, replay, signature/provenance and ineligible-integration checks. Add explicit `case-pass`, `completed`, and exactly one delivered expected speech assertion, so artifact quality cannot stand in for completion or leak the private final model text as speech.

This is a legitimate explicit synthetic profile alignment, not evidence that a live model can complete under 256 output tokens. The retained failure and successful run support the reservation diagnosis: the successful seventh payload was 27,357 bytes, and its reservation plus 720 already settled tokens was `27,357 + 1,024 + 256 + 720 = 29,357`. Using the old 1,024 output reservation on that same payload would require 30,125, above the unchanged grant; serializing `1024` instead of `256` also adds one payload byte. The failed aggregate did not retain the rejected seventh payload itself, so this arithmetic is a counterfactual using the successful measured payload, not an invented measurement of the failed request.

## Objective quality and admission review

`PrivatePacket.claim` is restricted to `objective-artifact`; `assessObjectiveArtifacts` intentionally grades the retained artifact/check outcomes. A repaired artifact can earn quality 3 while its producing run remains blocked. This does not create live admission: `toReleaseEvidence` separately requires the original adapter's `case-pass` verdict and `completed` observation, plus exact invoked configuration, provenance, physical receipts, private re-verification, finite original ledger and authenticated product experiment. Synthetic observations are rejected before live conversion. No product-code correction is indicated by this failure.

## Exact verification

Run in the isolated worktree with the root `node_modules` symlink, without installing dependencies. Root granted one exclusive physical case window; no aggregate rerun was performed.

```sh
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH npm run check
PATH=/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin:$PATH AEON_QUALIFICATION_FIXTURE=1 node --test evaluations/qualification/composition.test.ts
```

Strict check: exit 0. Exact opt-in case: exit 0, **1 passed, 0 failed, 0 skipped**, 9434.548287 ms case time, 9822.798612 ms total. Seven successful Mistral-shaped fixture responses; six real tool effects, including the deliberately failed command and repaired verification; two private confined checker commands. The original adapter records `completed`, `case-pass`, quality 3, one delivered explicit speech, 13 application requests and 840 declared synthetic tokens. The final observer ledger contains all 15 requests including both private checks. The original-grant and replay rejection assertions passed.

Observed dispatched payload sizes: `[23813, 24396, 25035, 25478, 26255, 26639, 27357]`. No provider network calls or external messages were used.

Exact successful artifact identities from the original adapter:

| Identity | SHA-256 |
|---|---|
| Source | `594f0204d89bf1a828dd53beea36d0f484f186d778eee905dee9fd926c10afb2` |
| Dependencies | `7786dd913ce6c06feee381de71c91dbb6e22845b8d0eaa4568c7603022ab8165` |
| Configuration | `84d361a7c684fa15e56b849c8677bf2b209431978c7720f749dd96f1c7e60bad` |
| Mind prompt | `cee3dd7239df56948e118f386539dc0a0c5e8c9a883b2e8b415f0b0a24844338` |
| Compaction prompt | `5afafc80e39ff98fac21cef62f4d3077236b7625dabc68d6b7bb407ef8cd10eb` |
| Observer artifact | `58a3a1a3db748571962d44c268d1c73879125988c94a2535628fbc6e3df6f4d9` |

Logs remain outside the repository under `/home/palimpsest/migration/aeon-1-20261011/integration-evidence/`:

| Log | SHA-256 |
|---|---|
| `aggregate-ea5e445.log` (preserved failure) | `f8796c16a5e2062517e273e2471a1534fdd423d5934a59f2a85b20fbcb26e554` |
| `qualification-composition-strictcheck.log` | `33792e951084ef06e5350c5ba85c3ad69188d94cefd288b7dbd0747999c93997` |
| `qualification-composition-review.log` | `774b24da2b5d15866f1681152cdd4937527cd16829eb86e38817210c9178d0ea` |

## Bounded acceptance and next owner

Accept this fixture profile correction and the strengthened completion checks for root integration. The previous aggregate failure remains preserved; this exact pass does not retroactively turn that aggregate green. This review makes no live Mistral, comparator parity, longitudinal growth, deployment or H1 claim. The run remains signed integration evidence and ineligible for live admission. Root reviews the two-file diff and integrates the handoff revision; final joined evidence and open capability gates remain with L09.
