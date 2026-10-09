import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeEvidence,
  buildEvidencePacket,
  canonicalize,
  hashEvidencePacket,
} from '../../lib/evidence.mjs';

const terms = 'Service must produce two artifacts, three signed events, no failed health checks, and latency below 2000 ms.';
const evidence = {
  signedBy: 'agent:test',
  service: 'test-agent',
  window: { start: 'a', end: 'b' },
  events: [
    { type: 'healthcheck', status: 200, latencyMs: 500 },
    { type: 'artifact', name: 'one' },
    { type: 'artifact', name: 'two' },
  ],
};

test('canonicalization is stable across key order', () => {
  assert.equal(canonicalize({ b: 2, a: 1 }), canonicalize({ a: 1, b: 2 }));
});

test('structurally complete evidence is ready for review, not verified', () => {
  const result = analyzeEvidence(terms, evidence);
  assert.equal(result.label, 'READY FOR REVIEW');
  assert.equal(result.score, 100);
  assert.equal(result.checks[1].label, 'Three or more event records');
});

test('failed health check prevents a ready result', () => {
  const result = analyzeEvidence(terms, {
    ...evidence,
    events: [{ type: 'healthcheck', status: 503, latencyMs: 2500 }],
  });
  assert.equal(result.label, 'NEEDS EVIDENCE');
  assert.ok(result.score < 100);
});

test('missing healthcheck cannot pass the local structure checks', () => {
  const result = analyzeEvidence(terms, {
    ...evidence,
    events: [{ type: 'artifact' }, { type: 'artifact' }, { type: 'artifact' }],
  });
  assert.equal(result.label, 'NEEDS EVIDENCE');
  assert.equal(result.checks[2].pass, false);
  assert.equal(result.checks[3].pass, false);
});

test('evidence must be a JSON object', () => {
  assert.throws(() => analyzeEvidence(terms, null), /JSON object/);
});

test('packet hashes are reproducible when packet data is unchanged', async () => {
  const assessment = analyzeEvidence(terms, evidence);
  const packet = buildEvidencePacket(terms, evidence, assessment);
  packet.createdAt = '2026-09-14T00:00:00.000Z';
  assert.equal(await hashEvidencePacket(packet), await hashEvidencePacket({ ...packet }));
});

test('case hash ignores packet creation time and local preflight wording', async () => {
  const assessment = analyzeEvidence(terms, evidence);
  const packet = buildEvidencePacket(terms, evidence, assessment);
  assert.equal(await hashEvidencePacket(packet), await hashEvidencePacket({
    ...packet,
    createdAt: '2030-01-01T00:00:00.000Z',
    preflight: { label: 'different local result' },
  }));
});

test('case hash changes when public evidence URL changes', async () => {
  const assessment = analyzeEvidence(terms, evidence);
  const packet = buildEvidencePacket(terms, evidence, assessment);
  assert.notEqual(await hashEvidencePacket(packet), await hashEvidencePacket({
    ...packet,
    publicEvidenceUrl: 'https://example.com/proof',
  }));
});
