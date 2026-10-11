# Aeon host service and releases

The host coordinator runs one accepted frozen application. It owns `state/supervisor-lease.sqlite`, the authority ledger, and the release journal. The child owns the separate `state/process-lease.sqlite` execution lease. Host state, source artifacts and workspaces are distinct absolute directories outside the source checkout. The retired service remains decommissioned.

Use the pinned Node 24 executable. The CLI is source executable; no installed package edits or upstream publication are required:

```sh
node deployment/cli.ts freeze /absolute/candidate-source /absolute/artifacts /absolute/deployment-inputs.json
node deployment/cli.ts inspect /absolute/artifacts CANDIDATE_ID /absolute/node
node deployment/cli.ts supervise /absolute/host.json
```

`freeze` takes the `DeploymentInputs` schema from [candidate.ts](candidate.ts). It freezes the complete retained source/toolchain closure and the logical configuration, prompts, model, runtime digest and public policy descriptor. Physical state/workspace/artifact/runtime/cgroup paths are host bindings. A candidate cannot introduce them through a release request. `inspect` rehashes the frozen closure and pinned runtime before returning its manifest.

The supervisor configuration is an owner-only regular JSON file with these fields:

```json
{
  "host": {
    "stateDirectory": "/absolute/state",
    "workspaceDirectory": "/absolute/workspaces",
    "artifactStore": "/absolute/artifacts",
    "nodeBinary": "/absolute/node"
  },
  "mode": "engineering",
  "evidenceDirectory": "/absolute/evidence",
  "policyFiles": [["POLICY_SHA256", "/absolute/host-policy.json"]],
  "bootstrap": {
    "proofFile": "/absolute/external-initial-proof.json",
    "policyDigest": "POLICY_SHA256"
  }
}
```

Provide `MISTRAL_API_KEY` and `AUTARK_DIRECT_TOKEN` in the host environment; Slack secrets are needed only when the frozen application enables Slack. The supervisor passes credentials only to its trusted application child; model workers do not receive host secrets or their paths. No inference is needed for acceptance, process recovery or shutdown.

The first start requires an external `ReleaseProof` under the explicitly configured policy. Its prior authority must identify epoch 1, the chosen first generation and the frozen candidate controls. Its retained rescue is that same candidate's `candidate.json`. The host verifies all signed evidence before writing the first authority and accepts the controller journal before starting an application. A crash between those two journals can resume only the original matching grant and signed proof. Later startup ignores the optional bootstrap files and recovers the retained accepted target with a fresh authority generation. It can operate with the evaluator key, proof and evidence store unavailable.

Host policy files use `HostPolicyFile` in [host-policy.ts](host-policy.ts): `controlRevision`, `policyDigest`, `descriptor`, and `keyFiles`. The descriptor is exactly the public `policyDescriptor()` output: `kind`, `requiredCases`, `evaluatorArtifacts` and `evaluatorKeyDigests`. `keyFiles` is an array of evaluator-ID/absolute-file-path pairs. Every key file must be owner-only, singly linked and at least 32 bytes; its bytes must match the public digest. Policy and key files must remain outside the artifact and workspace roots. The admission policy identity includes the candidate control revision. Populate it with the existing `admissionPolicyIdentity()` helper after freezing the candidate. The CLI neither creates a policy nor signs evidence.

Evidence references have only the form `sha256:HEX_DIGEST`. The host reads a regular file named `HEX_DIGEST` directly under `evidenceDirectory` and verifies its content digest. Arbitrary paths, URLs and network reads are rejected. Bootstrap and release proof files use the existing `ReleaseProof` contract; fresh probation evidence must target the original judging authority and retained rescue, with new evidence IDs. Fixture HMAC receipts are engineering evidence and do not establish independent product qualification or H1.

The running supervisor exposes an owner-only Unix socket under `state/host-control/supervisor.sock`, inside an owner-only directory. The CLI accepts explicit host proof files and sends their JSON contents. The socket accepts exact command fields and never resolves a caller-supplied file path:

```sh
node deployment/cli.ts status /absolute/state
node deployment/cli.ts release /absolute/state /absolute/external-release-proof.json
node deployment/cli.ts probation /absolute/state /absolute/fresh-probation-proof.json
node deployment/cli.ts recover /absolute/state
node deployment/cli.ts stage-control /absolute/state /absolute/old-policy-proof.json NEXT_POLICY_SHA256
node deployment/cli.ts activate-control /absolute/state STAGE_ID
```

Register the next policy in the host configuration before launching the coordinator. `stage-control` evaluates under the incumbent policy, checks that the changed frozen controls bind the next public descriptor, and durably records a stage without activating it. `activate-control` requires that same incumbent authority. The new policy cannot judge its own replacement or probation. Ordinary release rejects a control change. All release mutations are serialized; concurrent operations fail visibly.

For product mode set `mode` to `product`, provide a product policy, freeze an explicit logical `resourceLimits` profile, and add the physical `host.cgroupRoot`. Provision the delegated cgroup and bounded persistent workspace before launch. The coordinator initializes resource delegation after acquiring its supervisor lease, then probes the frozen limits and workspace. Each child initializes delegation only after acquiring its execution lease. Missing or ineffective resource enforcement leaves execution unavailable. Engineering mode is explicitly reported as `engineering-only`; `product-policy` reports the policy gate and does not claim H1 acceptance.

Transfer withdraws the predecessor's authority, stops and awaits the actual service process, and verifies that the execution lease is drained before granting a successor. The payload is rehashed before execution. A failed start is fenced; explicit recovery restarts the accepted rescue. Unexpected child exit triggers one local recovery attempt. A failed attempt stays unavailable with a failure status and retained release history; it does not loop indefinitely. Startup after a host crash always performs accepted recovery rather than silently accepting an interrupted or probation candidate.

Send SIGTERM or SIGINT to the supervisor for shutdown. It stops accepting controls, waits for the current mutation, withdraws authority, drains the child and closes its lease. Operational history, developmental state, uncertain effects, retained candidate artifacts and release evidence remain on disk. Code recovery always uses the current operational state directory; it never restores a memory snapshot. Private failed-start details are stored under `state/host-diagnostics`. No command installs, uninstalls or revives the legacy service.
