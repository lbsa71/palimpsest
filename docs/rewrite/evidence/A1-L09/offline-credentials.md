# Recovery without model credentials

Scope: A1-L09 recovery and A1-L07 durable intake. Implementation `c8a0abc`, 2026-10-11. The installed succession rehearsal prompted inspection of two unconditional selected-provider key checks: installer preflight and application construction. Both prevented independent offline rescue when a model credential was unavailable, even though no inference was needed to load retained state or expose authenticated status.

The application regression first failed at the unchanged constructor with `Selected provider credential unavailable`. Startup now retains direct authentication while allowing a missing model key. Health reports `provider-credential-unavailable`; both ordinary resume and scheduler admission hold inference before consuming a request or a goal slice. Known local reconciliation and durable intake remain available. The provider gateway still requires the exact selected provider's key when inference is actually permitted; an unrelated key does not substitute for it.

The regression starts an application, retains a latest-state/uncertain-effect marker and the original allocation, closes it, reopens without the selected key, admits an authenticated direct request, and checks zero physical requests and zero fixture transport calls. A later reopen with the selected credential completes that same request with one fixture inference while preserving the allocation. This is an actual local application/restart test with a synthetic provider; it does not prove paid connectivity or installed failure recovery.

Commands used Node `/opt/palimpsest/runtime/node-v24.13.0-linux-x64/bin/node`:

```text
node --test --test-name-pattern='offline recovery retains state' deployment/application.test.ts
# before: 0/1; constructor rejects missing selected key
node --test --test-name-pattern='offline recovery retains state|authenticated health|OpenAI' deployment/application.test.ts
# final: 6/6, zero skips, 3.921 seconds
node --test deployment/installation.test.ts
# 7 passed, 2 explicit mounted-volume skips, 5.974 seconds
npm run check
# passed
```

The first post-fix run was 5/6 because the new fixture searched an unprefixed external input ID. Direct intake deliberately namespaces that ID by actor. The fixture now uses the actual HTTP admission response's run ID. This failure was retained separately; no product guard or assertion was weakened.

Logs are outside the checkout under `/home/palimpsest/migration/aeon-1-20261011/integration-evidence/`:

| Log | SHA-256 |
|---|---|
| `offline-credential-before.log` | `a345473fc1a8d83b373a2efe6cb9f73ea177b6cdfa67b0b827081358149b429e` |
| `offline-credential-after.log` | `7f3c6c6b7cea068d27d4e6f752ca1bd69bb30e456c36248039d251890902a763` |
| `offline-credential-final.log` | `7361599fc2d276f98e350a2c97ee33eb46cccdd38ae57afa3b0fcf1b234e3879` |
| `offline-credential-installation.log` | `400cca8ffdb1ec778ec2510992d45f077fc4322b6fb011fa6423428282dd6048` |

Independent review, full joined checks and the actual installed failed-successor rehearsal remain separate gates. No live provider call, credential disclosure, external message or production installation occurred in these checks.
