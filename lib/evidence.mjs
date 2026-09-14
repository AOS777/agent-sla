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
  const events = Array.isArray(evidence.events) ? evidence.events : [];
  const failedHealthCheck = events.some(
    (event) => event?.type === 'healthcheck' && Number(event.status) >= 400,
  );
  const excessiveLatency = events.some(
    (event) => event?.type === 'healthcheck' && Number(event.latencyMs) >= 2000,
  );
  const checks = [
    { label: 'Machine-readable evidence', pass: Boolean(evidence.service && evidence.window) },
    { label: 'Three or more signed events', pass: events.length >= 3 && Boolean(evidence.signedBy) },
    { label: 'No failed health checks', pass: !failedHealthCheck },
    { label: 'Latency below the stated limit', pass: !excessiveLatency },
    { label: 'Explicit decision criteria', pass: terms.trim().length >= 80 },
  ];
  const score = checks.filter((check) => check.pass).length * 20;
  return {
    label: score === 100 ? 'CONSENSUS READY' : 'NEEDS EVIDENCE',
    score,
    checks,
  };
}

export function buildEvidencePacket(terms, evidence, assessment) {
  return {
    schema: 'agentsla/evidence-pack@1',
    createdAt: new Date().toISOString(),
    terms: terms.trim(),
    evidence,
    preflight: {
      label: assessment.label,
      score: assessment.score,
      checks: assessment.checks,
      notice: 'Pre-flight only. The final verdict must be produced by GenLayer consensus.',
    },
  };
}

export async function hashEvidencePacket(packet) {
  const bytes = new TextEncoder().encode(canonicalize(packet));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
