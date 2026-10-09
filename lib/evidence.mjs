export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function analyzeEvidence(terms, evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new TypeError('Evidence must be a JSON object');
  }
  const events = Array.isArray(evidence.events) ? evidence.events : [];
  const healthChecks = events.filter((event) => event?.type === 'healthcheck');
  const failedHealthCheck = healthChecks.some(
    (event) => event?.type === 'healthcheck' && Number(event.status) >= 400,
  );
  const excessiveLatency = healthChecks.some(
    (event) => event?.type === 'healthcheck' && Number(event.latencyMs) >= 2000,
  );
  const checks = [
    { label: 'Machine-readable evidence', pass: Boolean(evidence.service && evidence.window) },
    { label: 'Three or more event records', pass: events.length >= 3 },
    { label: 'At least one passing healthcheck record', pass: healthChecks.length > 0 && !failedHealthCheck },
    { label: 'Observed healthcheck latency below 2000 ms', pass: healthChecks.length > 0 && !excessiveLatency },
    { label: 'Explicit decision criteria', pass: terms.trim().length >= 80 },
  ];
  const score = checks.filter((check) => check.pass).length * 20;
  return {
    label: score === 100 ? 'READY FOR REVIEW' : 'NEEDS EVIDENCE',
    score,
    checks,
  };
}

export function buildEvidencePacket(terms, evidence, assessment, publicEvidenceUrl = '') {
  return {
    schema: 'agentsla/evidence-pack@1',
    createdAt: new Date().toISOString(),
    terms: terms.trim(),
    evidence,
    publicEvidenceUrl: publicEvidenceUrl.trim(),
    preflight: {
      label: assessment.label,
      score: assessment.score,
      checks: assessment.checks,
      notice: 'Structural checks only. Signatures, signer identity, artifact hashes, and claims are not cryptographically verified here. The final verdict must be produced by GenLayer consensus.',
    },
  };
}

export async function hashEvidencePacket(packet) {
  const { schema, terms, evidence, publicEvidenceUrl = '' } = packet;
  const bytes = new TextEncoder().encode(canonicalize({ schema, terms, evidence, publicEvidenceUrl }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
