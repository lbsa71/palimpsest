import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { assessScreenWitness } from './screen.ts';
import { publicRehearsalPacket } from './screen-driver.ts';
import { canonicalJson, identity, type ArtifactRef } from '../../packages/contracts/index.ts';
import { OperationalStore } from '../../packages/storage/index.ts';
import { QualificationStore } from '../qualification/store.ts';
import { AuthorityStore } from '../../packages/supervisor/authority.ts';
import { hashBytes } from '../../packages/release/artifacts.ts';
import type { ApplicationConfig } from '../../deployment/config.ts';
import { publicScreenGateway, retainedOperationalEvidence, retainPublicReport } from './public-screen-host.ts';

// This unit file intercepts fetch only within node:test. It never dispatches a
// network request, constructs an application, or issues host authority.
const secrets = { mistralApiKey: 'REVIEW-NONCREDENTIAL-PROVIDER-CANARY', directToken: 'REVIEW-NONCREDENTIAL-DIRECT-CANARY' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'aeon-public-independent-'));
  const stateDirectory = join(root, 'state'), applicationRoot = join(root, 'source');
  mkdirSync(stateDirectory); mkdirSync(applicationRoot);
  const state = new OperationalStore({ filename: join(stateDirectory, 'operational.sqlite'), checkoutRoot: applicationRoot });
  state.close();
  const config = { stateDirectory, applicationRoot } as ApplicationConfig;
  return { root, config, open: () => new OperationalStore({ filename: join(stateDirectory, 'operational.sqlite'), checkoutRoot: applicationRoot }), close: () => rmSync(root, { recursive: true, force: true }) };
}

test('fixed gateway retains exact response bytes and excludes explicit secrets from durable evidence', async t => {
  const f = fixture(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls++; assert.equal(url, 'https://api.mistral.ai/v1/chat/completions');
    assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${secrets.mistralApiKey}`);
    return new Response('{"offline":"exact response"}', { status: 202 });
  });
  try {
    const gateway = publicScreenGateway(f.config, secrets, { maxArtifactBytes: 1000, maxEvidenceBytes: 10000, grantId: 'review-original' });
    const response = await gateway('{"offline":"payload"}', AbortSignal.timeout(1000));
    assert.deepEqual(response, { status: 202, body: '{"offline":"exact response"}' }); assert.equal(calls, 1);
    const state = f.open();
    try {
      const rows = state.list<{ response: ArtifactRef }>('screen.lifecycle-provider-responses');
      assert.equal(rows.length, 1); assert.equal(Buffer.from(state.readArtifact(rows[0]!.value.response)).toString(), response.body);
      const evidence = canonicalJson({ rows, events: state.events() });
      for (const secret of Object.values(secrets)) assert.equal(evidence.includes(secret), false);
    } finally { state.close(); }
  } finally { f.close(); }
});

test('known original total and artifact exhaustion refuse before even the intercepted provider call', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('offline'); });
  for (const kind of ['total', 'artifact'] as const) {
    const f = fixture();
    try {
      const state = f.open(); state.putArtifact('x'.repeat(1200)); state.close();
      const evidence = retainedOperationalEvidence(f.config.stateDirectory); assert.equal(evidence.maxArtifactBytes, 1200);
      const gateway = publicScreenGateway(f.config, secrets, { maxArtifactBytes: kind === 'artifact' ? 1000 : 2000, maxEvidenceBytes: kind === 'total' ? 1000 : 10000, grantId: `review-${kind}` });
      await assert.rejects(gateway(`{"kind":"${kind}"}`, AbortSignal.timeout(1000)), /ceiling|allowance/);
      assert.deepEqual(retainedOperationalEvidence(f.config.stateDirectory), evidence);
    } finally { f.close(); }
  }
  assert.equal(calls, 0);
});

test('a returned provider secret is refused without retaining secret-bearing body or a success receipt', async t => {
  const f = fixture(); let body = 'OFFLINE harmless baseline';
  t.mock.method(globalThis, 'fetch', async () => new Response(body));
  try {
    const gateway = publicScreenGateway(f.config, secrets, { maxArtifactBytes: 1000, maxEvidenceBytes: 10000, grantId: 'review-secret' });
    await gateway('baseline', AbortSignal.timeout(1000));
    const before = retainedOperationalEvidence(f.config.stateDirectory);
    for (const secret of Object.values(secrets)) {
      body = `echo ${secret}`;
      await assert.rejects(gateway(`secret-${identity(secret)}`, AbortSignal.timeout(1000)), /protected host secret/);
      assert.deepEqual(retainedOperationalEvidence(f.config.stateDirectory), before);
    }
  } finally { f.close(); }
});

test('ordinary JSON string escaping cannot conceal a provider secret from the retention guard', async t => {
  const f = fixture();
  const escape = (value: string) => [...value].map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  let body = `{"message":"${escape('PUBLIC harmless baseline')}"}`;
  t.mock.method(globalThis, 'fetch', async () => new Response(body));
  try {
    const gateway = publicScreenGateway(f.config, secrets, { maxArtifactBytes: 2000, maxEvidenceBytes: 10000, grantId: 'review-escaped-secret' });
    assert.equal(JSON.parse((await gateway('baseline', AbortSignal.timeout(1000))).body).message, 'PUBLIC harmless baseline');
    const before = retainedOperationalEvidence(f.config.stateDirectory);
    body = `{"message":"${escape(secrets.mistralApiKey)}"}`;
    assert.equal(body.includes(secrets.mistralApiKey), false); assert.equal(JSON.parse(body).message, secrets.mistralApiKey);
    await assert.rejects(gateway('escaped-secret', AbortSignal.timeout(1000)), /protected host secret/);
    assert.deepEqual(retainedOperationalEvidence(f.config.stateDirectory), before);
  } finally { f.close(); }
});

test('normal provider tool-argument JSON decoding cannot reveal a secret after retention', async t => {
  const f = fixture();
  const escaped = (value: string) => [...value].map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  const responseFor = (value: string) => JSON.stringify({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'workspace_write', arguments: `{"path":"public.txt","content":"${escaped(value)}"}` } }] } }] });
  let body = responseFor('PUBLIC ordinary argument');
  t.mock.method(globalThis, 'fetch', async () => new Response(body));
  try {
    const gateway = publicScreenGateway(f.config, secrets, { maxArtifactBytes: 4000, maxEvidenceBytes: 20000, grantId: 'review-nested-secret' });
    assert.equal((await gateway('baseline', AbortSignal.timeout(1000))).body, body);
    const before = retainedOperationalEvidence(f.config.stateDirectory); body = responseFor(secrets.mistralApiKey);
    const args = JSON.parse(body).choices[0].message.tool_calls[0].function.arguments;
    assert.equal(args.includes(secrets.mistralApiKey), false); assert.equal(JSON.parse(args).content, secrets.mistralApiKey);
    await assert.rejects(gateway('nested-secret', AbortSignal.timeout(1000)), /protected host secret/);
    assert.deepEqual(retainedOperationalEvidence(f.config.stateDirectory), before);
  } finally { f.close(); }
});

test('gateway refuses response retention when its required receipt would cross the original byte ceiling', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('OFFLINE-body'));
  const baseline = fixture(), limited = fixture();
  try {
    for (const f of [baseline, limited]) { const state = f.open(); state.putArtifact('x'.repeat(99950)); state.close(); }
    const enough = publicScreenGateway(baseline.config, secrets, { maxArtifactBytes: 100000, maxEvidenceBytes: 200000, grantId: 'review-receipt' });
    assert.equal((await enough('same-payload', AbortSignal.timeout(1000))).body, 'OFFLINE-body');
    const required = retainedOperationalEvidence(baseline.config.stateDirectory).bytes;
    assert.ok(required > 100000, 'passing baseline must demonstrate material receipt overhead');
    assert.equal(retainedOperationalEvidence(limited.config.stateDirectory).bytes, 99950);
    const short = publicScreenGateway(limited.config, secrets, { maxArtifactBytes: 100000, maxEvidenceBytes: 100000, grantId: 'review-receipt' });
    await assert.rejects(short('same-payload', AbortSignal.timeout(1000)), /allowance|ceiling/);
  } finally { baseline.close(); limited.close(); }
});

test('report allowance counts repeated logical chunks despite content-addressed physical deduplication', () => {
  const root = mkdtempSync(join(tmpdir(), 'aeon-public-chunks-review-')), store = new QualificationStore(root);
  try {
    const report = { body: 'x'.repeat(25000) }, limits = { maxArtifactBytes: 4000, maxEvidenceBytes: 50000 };
    const manifestRef = retainPublicReport(store, report, limits, 1000), manifest = JSON.parse(store.readArtifact(manifestRef).toString()) as { parts: ArtifactRef[]; bytes: number };
    assert.ok(new Set(manifest.parts.map(p => p.sha256)).size < manifest.parts.length, 'baseline must have duplicate retained logical chunks');
    const bytes = Buffer.concat(manifest.parts.map(p => Buffer.from(JSON.parse(store.readArtifact(p).toString()).content, 'base64')));
    assert.equal(bytes.toString(), canonicalJson(report));
    const total = 1000 + store.readArtifact(manifestRef).length + manifest.parts.reduce((sum, p) => sum + store.readArtifact(p).length, 0);
    assert.ok(total < limits.maxEvidenceBytes);
    const before = readdirSync(root).sort();
    assert.throws(() => retainPublicReport(store, report, { ...limits, maxEvidenceBytes: total - 1 }, 1000), /allowance/);
    assert.deepEqual(readdirSync(root).sort(), before);
    assert.equal(retainPublicReport(store, report, { ...limits, maxEvidenceBytes: total }, 1000).sha256, manifestRef.sha256);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('required auxiliary bytes and missing or changed original evidence stop dispatch without recreating authority', async t => {
  const f = fixture(), privateRoot = join(f.root, 'private'); mkdirSync(privateRoot);
  const packetFile = join(privateRoot, 'packet.json'), packet = '{"public":"original"}'; writeFileSync(packetFile, packet, { mode: 0o600 });
  const authorityPath = join(f.config.stateDirectory, 'authority.sqlite'), authority = new AuthorityStore(authorityPath);
  authority.bootstrap('review-original', identity('review-control'), identity('review-candidate')); authority.close();
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('OFFLINE baseline'); });
  const auxiliary = { claimBytes: 1500, packetFile, packetSha256: hashBytes(packet), privateRoot, authorityPath, caseId: 'S01' as const, attempt: 1, experimentId: 'review-auxiliary' };
  try {
    const gateway = publicScreenGateway(f.config, secrets, { maxArtifactBytes: 2000, maxEvidenceBytes: 10000, grantId: 'review-auxiliary', auxiliary });
    await gateway('baseline', AbortSignal.timeout(1000)); assert.equal(calls, 1);
    const before = retainedOperationalEvidence(f.config.stateDirectory);
    const limited = publicScreenGateway(f.config, secrets, { maxArtifactBytes: 2000, maxEvidenceBytes: before.bytes + 1499, grantId: 'review-auxiliary', auxiliary });
    await assert.rejects(limited('known-claims-over-limit', AbortSignal.timeout(1000)), /allowance/);
    writeFileSync(packetFile, packet.replace('original', 'modified'));
    await assert.rejects(gateway('changed-packet', AbortSignal.timeout(1000)), /packet bytes changed/);
    rmSync(packetFile);
    await assert.rejects(gateway('missing-packet', AbortSignal.timeout(1000)), /evidence unavailable/);
    writeFileSync(packetFile, packet, { mode: 0o600 }); rmSync(authorityPath);
    await assert.rejects(gateway('missing-authority', AbortSignal.timeout(1000)), /evidence unavailable/);
    assert.equal(existsSync(authorityPath), false); assert.equal(calls, 1);
    assert.deepEqual(retainedOperationalEvidence(f.config.stateDirectory), before);
  } finally { f.close(); }
});

// Exact acquired initial1 S01 witness, from immutable report c557be56fb6778b2828cf6e17f44b42d80ee70736808d29f7ca6d266b3538291.
// Compression keeps the self-contained historical fixture small; it is parsed only as data.
test('exact failed S01 witness keeps assessment evidence identity across canonical retention order', () => {
  const bytes = gunzipSync(Buffer.from('H4sIAAAAAAACA+1Y227bRhD9FYFPLSAme1+uihRo+xQgD0UvL42DYnZ31mJMkyovTg1D/95Z2k7kwA7qS2QHiV8s0tbwzJkzc2Z5VoQ1hqNNV7djsToroB/rBGH+PKxBaFOsiuidtl4k4WSwnFkHIIOQyfHKJKclizzwADogcF9xxYRAwVPgkTtmNS+WxdTXFAiwa1eXj1jdO+x2WXR+wP4ExrprX8ahWL0uxq5rVv3UrkJyJlY+Rhuj5gxcdCzpoILXBq0xXhkhuIhGKPReg6sEiyGxylS6ismtYBjqYYR2XIkIIXrGyqQrXyorbQkmQallSBosS5Lz1RB6xJbln5zxZ8ERQpQWXCmhYqUSUZagBZZCeGkJVgz+Cg7xmXCoykivrSyFsxkHQukBeQlKR211YFHKXRyyeLMsejypB6pTseJ0MVG9SBEPAYySHNbYNBRuU5eVQx1EeJ61Vvq+jodYnsxaCeu6iT0SgNcEJ2KDh7NwhvMbqW5wmHugHd5h/+ztkLEWZwcFtmN/OrfIQbE6KIY+PD+Gun12/HY4KJYHhcc1nNRdP//1kLIe6/Zw0eM49e2wyNC6Req748W4xsVusO1BO4t4GjfTeAHjoZkZYZwodOGbLhxhvFBEfthZgSnhea/DNK67vh5P80XoCGPX/Pa+YIW1zkpghMAnoZJToCRLjglvPCcwQgFAYjwqqbiVwaigE+cEG5hDl3WImy6s59ofYov9zDxF/vXPn1+9/KX8nfGybuuxhiYzUmcGnkonH9VthvOu64+GDQT8u0fIPG7gtOnoEzG2gXGd5QfhCA7xXDrbLPmA9ebqME0cCZ5LQQZplFeWxco6RzmgdpSOjinFSkkZwApRJcGITROD5j4YI+GGYXrvsDPcnWH6hArwYXLIh++P0G0wF+iiysTB2NdhnDtl09dtqDcwt8ulVPEEmgnGri/ebHf6a5hCQIzz94YRNw8G8pbkfeSKObWn2E3E89SMM8fdCbbQhrkKJOWun6k7n03l3EIn2Bd5Yvf1ZVIXKc5s0790PRH/EzVaIZgwJWcl538IueJqpcwzyuavXJVu6gM+qTUhK+ihBX2R5eOo7+NqP2onLIvcqnhpaZhX3Ozn4+kGZ68+7uLU4Ozh2dCvcffs0Mtrx/vyw0i3QsVIO49lXjNng9IuyRiTFpCkkSnf1QRWR/JIJ9DSb+FFBcyYGAU7t+l+fFW3BJZv81jBfyace8Jtl1+lUd9h1f3/Rr1b5JuM2nKojEncQhWsALQ8VCYmOpPYysuKqh1T5o+hjjIoQ7lUQVviV4DiSd5g1PcOuy+jvkMBvhn1Lcjbq1HfvZv2adRa7smob03Hl2XUd6j2o3bCtUaN/266flzQjWFcvD9Vv1h89/3ixY+Lg+IT5+ofdl37yqzfcW2aqy6gsgI9oENT2cRBO0mIQ5BeVYYDnZgSJ2OMvApk8VqQt7PE6XzFzCddm5uv07Zv/2boGtt+R0ThVd++sr991vcxyyw8zL7y+4VS2qlp3qtp9+XQDYuDTy4YcMgFAzRqzhwBrAdvA+2FVFHLTTROShe9h4rHaJQ1IginXMQbFod7h93T4nAXCXxbHG5B3j4Xh3v08z4XB6vMXhaHO7z4/pIWh7tU+1E7YWdx8Ji6Hq/O7FinNGsujaSvfXjHOQp6VG7SayxjZ/8ARnuElkEITZsQeGbI7oXy1nMa30SkTYYbB8IKSdfKclFx6YPgzBA1rri6cQi5fbP9Dx0HJXLPGwAA', 'base64'));
  assert.equal(hashBytes(bytes), 'abc6d34faa470ca6a2f2141fb52927b607ee6bf390b09fc9992e46bfdeeac954');
  const witness = JSON.parse(bytes.toString());
  // orderedTools originally constructs sequence/effect/observation, while sealing sorts keys.
  const originalOrder = { ...witness, tools: witness.tools.map((tool: any) => ({ sequence: tool.sequence, effect: tool.effect, observation: tool.observation })) };
  assert.equal(hashBytes(JSON.stringify(originalOrder.tools)), '0f249eda55f39d23e92521e988d8d1a559108c9d79c4a56fe0562a29a69c3821');
  const retainedOrder = JSON.parse(canonicalJson(originalOrder));
  assert.deepEqual(originalOrder, retainedOrder);
  const original = assessScreenWitness('S01', originalOrder, publicRehearsalPacket('S01'));
  assert.equal(original.quality, 0);
  assert.deepEqual(original.checks.filter(c => !c.passed).map(c => c.id), ['real-completed-run', 'explicit-output']);
  assert.deepEqual(assessScreenWitness('S01', retainedOrder, publicRehearsalPacket('S01')), original);
});
