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

test('complete signed evidence is consensus ready', () => {
  const result = analyzeEvidence(terms, evidence);
  assert.equal(result.label, 'CONSENSUS READY');
  assert.equal(result.score, 100);
});

test('failed health check prevents a ready result', () => {
  const result = analyzeEvidence(terms, {
    ...evidence,
    events: [{ type: 'healthcheck', status: 503, latencyMs: 2500 }],
  });
  assert.equal(result.label, 'NEEDS EVIDENCE');
  assert.ok(result.score < 100);
});

test('packet hashes are reproducible when packet data is unchanged', async () => {
  const assessment = analyzeEvidence(terms, evidence);
  const packet = buildEvidencePacket(terms, evidence, assessment);
  packet.createdAt = '2026-09-14T00:00:00.000Z';
  assert.equal(await hashEvidencePacket(packet), await hashEvidencePacket({ ...packet }));
});
