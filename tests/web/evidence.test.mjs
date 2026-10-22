import assert from 'node:assert/strict';
import test from 'node:test';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import {
  analyzeEvidence,
  buildEventSigningMessage,
  buildEvidencePacket,
  canonicalize,
  fetchAndHashPublicEvidence,
  hashEvidencePacket,
  serializeEvidencePacket,
  sha256Hex,
} from '../../lib/evidence.mjs';

const terms = 'Service must produce two artifacts, signed event records, no failed health checks, and latency below 2000 ms. PASS requires every mandatory criterion to pass.';

async function makeEvidence() {
  const account = privateKeyToAccount(generatePrivateKey());
  const report = new TextEncoder().encode('{"answer":42}\n');
  const summary = new TextEncoder().encode('# Summary\nCompleted.\n');
  const evidence = {
    service: 'test-agent',
    window: { start: '2026-09-14T08:00:00Z', end: '2026-09-14T08:30:00Z' },
    authorizedSigners: [{ address: account.address, role: 'agent-operator' }],
    criteria: [
      {
        id: 'availability',
        description: 'Every recorded health check must succeed.',
        required: true,
        evidenceEventIds: ['health-1'],
      },
      {
        id: 'deliverables',
        description: 'Both required artifacts must match their declared hashes.',
        required: true,
        evidenceEventIds: ['artifact-report', 'artifact-summary'],
      },
    ],
    events: [
      {
        id: 'health-1',
        at: '2026-09-14T08:03:12Z',
        type: 'healthcheck',
        status: 200,
        latencyMs: 500,
      },
      {
        id: 'artifact-report',
        at: '2026-09-14T08:14:09Z',
        type: 'artifact',
        name: 'report.json',
        sha256: await sha256Hex(report),
        contentBase64: Buffer.from(report).toString('base64'),
      },
      {
        id: 'artifact-summary',
        at: '2026-09-14T08:22:31Z',
        type: 'artifact',
        name: 'summary.md',
        sha256: await sha256Hex(summary),
        contentBase64: Buffer.from(summary).toString('base64'),
      },
    ],
  };

  for (const event of evidence.events) {
    event.signer = { address: account.address, scheme: 'eip191' };
    event.signer.signature = await account.signMessage({
      message: buildEventSigningMessage(evidence, event),
    });
  }
  return evidence;
}

test('canonicalization is stable across key order', () => {
  assert.equal(canonicalize({ b: 2, a: 1 }), canonicalize({ a: 1, b: 2 }));
});

test('valid signatures, artifact bytes, and criteria produce a verified preflight', async () => {
  const evidence = await makeEvidence();
  const result = await analyzeEvidence(terms, evidence);
  assert.equal(result.label, 'VERIFIED FOR REVIEW');
  assert.equal(result.score, 100);
  assert.ok(result.verification.eventSignatures.every((item) => item.valid));
  assert.ok(result.verification.artifacts.every((item) => item.valid));
});

test('tampering with a signed event invalidates its signature', async () => {
  const evidence = await makeEvidence();
  evidence.events[0].status = 503;
  const result = await analyzeEvidence(terms, evidence);
  assert.equal(result.label, 'NEEDS EVIDENCE');
  assert.equal(result.verification.eventSignatures[0].valid, false);
  assert.equal(result.checks.find((item) => item.label === 'Health checks succeeded').pass, false);
});

test('a signature from an unauthorized signer is rejected', async () => {
  const evidence = await makeEvidence();
  evidence.authorizedSigners = [];
  const result = await analyzeEvidence(terms, evidence);
  assert.equal(result.label, 'NEEDS EVIDENCE');
  assert.ok(result.verification.eventSignatures.every((item) => item.authorized === false));
});

test('changed artifact bytes fail SHA-256 verification and their bound event signature', async () => {
  const evidence = await makeEvidence();
  evidence.events[1].contentBase64 = Buffer.from('tampered').toString('base64');
  const result = await analyzeEvidence(terms, evidence);
  assert.equal(result.verification.artifacts[0].valid, false);
  assert.equal(result.verification.eventSignatures[1].valid, false);
});

test('mandatory criteria must reference existing event IDs', async () => {
  const evidence = await makeEvidence();
  evidence.criteria[0].evidenceEventIds = ['missing-event'];
  const result = await analyzeEvidence(terms, evidence);
  assert.equal(result.label, 'NEEDS EVIDENCE');
  assert.equal(result.checks.find((item) => item.label === 'Mandatory criteria reference existing evidence').pass, false);
});

test('an external URL is not accepted until its expected hash was verified', async () => {
  const evidence = await makeEvidence();
  const result = await analyzeEvidence(terms, evidence, {
    url: 'https://example.com/proof.json',
    sha256: 'a'.repeat(64),
    verified: false,
  });
  assert.equal(result.label, 'NEEDS EVIDENCE');
});

test('public evidence rejects loopback, link-local, and IPv6 URLs before fetching', async () => {
  await assert.rejects(() => fetchAndHashPublicEvidence('https://127.0.0.1/proof'), /public HTTPS URL/);
  await assert.rejects(() => fetchAndHashPublicEvidence('https://169.254.169.254/latest/meta-data'), /public HTTPS URL/);
  await assert.rejects(() => fetchAndHashPublicEvidence('https://[::1]/proof'), /public HTTPS URL/);
});

test('evidence must be a JSON object', async () => {
  await assert.rejects(() => analyzeEvidence(terms, null), /JSON object/);
});

test('packet hash anchors creation time, verification, terms, and evidence', async () => {
  const evidence = await makeEvidence();
  const assessment = await analyzeEvidence(terms, evidence);
  const packet = buildEvidencePacket(terms, evidence, assessment);
  assert.equal(await hashEvidencePacket(packet), await sha256Hex(serializeEvidencePacket(packet)));
  assert.notEqual(
    await hashEvidencePacket(packet),
    await hashEvidencePacket({ ...packet, createdAt: '2030-01-01T00:00:00.000Z' }),
  );
});

test('display-only hash fields do not recursively change the anchored packet', async () => {
  const evidence = await makeEvidence();
  const assessment = await analyzeEvidence(terms, evidence);
  const packet = buildEvidencePacket(terms, evidence, assessment);
  const hash = await hashEvidencePacket(packet);
  assert.equal(hash, await hashEvidencePacket({ ...packet, evidenceHash: hash, caseHash: hash }));
});
