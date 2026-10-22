import { isAddress, isAddressEqual, recoverMessageAddress } from 'viem';

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const SIGNATURE_PATTERN = /^0x[0-9a-f]{130}$/i;
const MAX_INLINE_ARTIFACT_BYTES = 8 * 1024;

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

export async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function decodeBase64(value) {
  const normalized = value.replace(/\s/g, '');
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new TypeError('Artifact contentBase64 is invalid');
  }
  const binary = atob(normalized);
  if (binary.length > MAX_INLINE_ARTIFACT_BYTES) {
    throw new RangeError('Inline artifacts are limited to 8 KiB');
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function eventWithoutSignature(event) {
  const signer = event?.signer && typeof event.signer === 'object'
    ? { ...event.signer }
    : event?.signer;
  if (signer && typeof signer === 'object') delete signer.signature;
  return { ...event, signer };
}

export function buildEventSigningMessage(evidence, event) {
  return [
    'AgentSLA signed event v1',
    canonicalize({
      service: evidence.service,
      window: evidence.window,
      event: eventWithoutSignature(event),
    }),
  ].join('\n');
}

function isHttpsPublicUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (host.includes(':') || host.includes('[') || host.includes(']')) return false;
    if (host === 'localhost' || host === 'localhost.' || host === '0.0.0.0' || host.endsWith('.local')) return false;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false;
    const carrierGradeNat = host.match(/^100\.(\d{1,3})\./);
    if (carrierGradeNat && Number(carrierGradeNat[1]) >= 64 && Number(carrierGradeNat[1]) <= 127) return false;
    const private172 = host.match(/^172\.(\d{1,3})\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    const firstOctet = Number(host.split('.', 1)[0]);
    if (Number.isInteger(firstOctet) && (firstOctet === 0 || firstOctet >= 224)) return false;
    if (host.split('.').length === 4 && host.split('.').every((part) => /^\d{1,3}$/.test(part))) return false;
    return true;
  } catch {
    return false;
  }
}

export async function fetchAndHashPublicEvidence(url) {
  if (!isHttpsPublicUrl(url)) {
    throw new TypeError('Public evidence must use a public HTTPS URL');
  }
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    headers: { Accept: 'application/octet-stream, text/plain;q=0.9, */*;q=0.1' },
  });
  if (!response.ok) throw new Error(`Public evidence returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 2 * 1024 * 1024) {
    throw new RangeError('Public evidence is limited to 2 MiB');
  }
  return { sha256: await sha256Hex(bytes), size: bytes.byteLength };
}

function check(label, pass, detail = '') {
  return { label, pass: Boolean(pass), detail };
}

export async function analyzeEvidence(
  terms,
  evidence,
  publicEvidence = { url: '', sha256: '', verified: false },
) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new TypeError('Evidence must be a JSON object');
  }

  const events = Array.isArray(evidence.events) ? evidence.events : [];
  const criteria = Array.isArray(evidence.criteria) ? evidence.criteria : [];
  const authorizedSigners = Array.isArray(evidence.authorizedSigners)
    ? evidence.authorizedSigners
    : [];
  const eventIds = new Set();
  const criterionIds = new Set();
  const signatureResults = [];
  const artifactResults = [];

  for (const event of events) {
    const eventId = typeof event?.id === 'string' ? event.id.trim() : '';
    const uniqueId = Boolean(eventId) && !eventIds.has(eventId);
    if (uniqueId) eventIds.add(eventId);

    const signerAddress = typeof event?.signer?.address === 'string'
      ? event.signer.address
      : '';
    const signature = typeof event?.signer?.signature === 'string'
      ? event.signer.signature
      : '';
    const signerAuthorized = isAddress(signerAddress)
      && authorizedSigners.some(
        (signer) => typeof signer?.address === 'string'
          && isAddress(signer.address)
          && isAddressEqual(signer.address, signerAddress),
      );
    let signatureValid = false;
    let recoveredAddress = '';
    if (uniqueId && signerAuthorized && SIGNATURE_PATTERN.test(signature)) {
      try {
        recoveredAddress = await recoverMessageAddress({
          message: buildEventSigningMessage(evidence, event),
          signature,
        });
        signatureValid = isAddressEqual(recoveredAddress, signerAddress);
      } catch {
        signatureValid = false;
      }
    }
    signatureResults.push({
      eventId: eventId || '(missing id)',
      signerAddress,
      recoveredAddress,
      authorized: signerAuthorized,
      valid: signatureValid,
    });

    if (event?.type === 'artifact') {
      const expectedHash = typeof event.sha256 === 'string' ? event.sha256.toLowerCase() : '';
      let actualHash = '';
      let valid = false;
      let detail = '';
      try {
        if (!SHA256_PATTERN.test(expectedHash)) throw new TypeError('Expected SHA-256 is invalid');
        const bytes = decodeBase64(String(event.contentBase64 ?? ''));
        actualHash = await sha256Hex(bytes);
        valid = actualHash === expectedHash;
        detail = valid ? `${bytes.byteLength} bytes verified` : 'Artifact content does not match its SHA-256';
      } catch (caught) {
        detail = caught instanceof Error ? caught.message : 'Artifact could not be verified';
      }
      artifactResults.push({
        eventId: eventId || '(missing id)',
        name: String(event?.name ?? ''),
        expectedHash,
        actualHash,
        valid,
        detail,
      });
    }
  }

  const criteriaWellFormed = criteria.length > 0 && criteria.length <= 20 && criteria.every((criterion) => {
    const criterionId = typeof criterion?.id === 'string' ? criterion.id.trim() : '';
    if (!criterionId || criterionIds.has(criterionId)) return false;
    criterionIds.add(criterionId);
    return typeof criterion.description === 'string'
      && criterion.description.trim().length >= 10
      && typeof criterion.required === 'boolean'
      && Array.isArray(criterion.evidenceEventIds)
      && criterion.evidenceEventIds.length > 0
      && criterion.evidenceEventIds.every((id) => typeof id === 'string' && eventIds.has(id));
  });
  const mandatoryCriteria = criteria.filter((criterion) => criterion?.required === true);
  const healthChecks = events.filter((event) => event?.type === 'healthcheck');
  const healthChecksPass = healthChecks.length > 0 && healthChecks.every(
    (event) => Number.isFinite(Number(event.status))
      && Number(event.status) >= 200
      && Number(event.status) < 400,
  );
  const latencyPasses = healthChecks.length > 0 && healthChecks.every(
    (event) => Number.isFinite(Number(event.latencyMs))
      && Number(event.latencyMs) >= 0
      && Number(event.latencyMs) < 2000,
  );
  const publicUrl = String(publicEvidence.url ?? '').trim();
  const publicHash = String(publicEvidence.sha256 ?? '').trim().toLowerCase();
  const publicEvidencePasses = (!publicUrl && !publicHash)
    || (isHttpsPublicUrl(publicUrl) && SHA256_PATTERN.test(publicHash) && publicEvidence.verified === true);

  const checks = [
    check('Machine-readable evidence identity and time window', Boolean(evidence.service && evidence.window)),
    check('Unique event IDs and three or more event records', events.length >= 3 && eventIds.size === events.length),
    check('Every event has a valid EIP-191 signature', signatureResults.length === events.length && signatureResults.every((result) => result.valid)),
    check('Every signer is explicitly authorized', signatureResults.length === events.length && signatureResults.every((result) => result.authorized)),
    check('Every artifact content matches its SHA-256', artifactResults.length > 0 && artifactResults.every((result) => result.valid)),
    check('Health checks succeeded', healthChecksPass),
    check('Observed healthcheck latency is below 2000 ms', latencyPasses),
    check('Mandatory criteria reference existing evidence', criteriaWellFormed && mandatoryCriteria.length > 0),
    check('Explicit SLA decision rules', typeof terms === 'string' && terms.trim().length >= 80),
    check('External evidence is absent or hash-verified', publicEvidencePasses),
  ];
  const passed = checks.filter((item) => item.pass).length;
  const score = Math.round((passed / checks.length) * 100);
  return {
    label: score === 100 ? 'VERIFIED FOR REVIEW' : 'NEEDS EVIDENCE',
    score,
    checks,
    verification: {
      eventSignatures: signatureResults,
      artifacts: artifactResults,
      publicEvidence: {
        url: publicUrl,
        sha256: publicHash,
        verified: publicEvidencePasses && Boolean(publicUrl),
      },
      allVerified: score === 100,
    },
  };
}

export function buildEvidencePacket(
  terms,
  evidence,
  assessment,
  publicEvidenceUrl = '',
  publicEvidenceSha256 = '',
) {
  return {
    schema: 'agentsla/evidence-pack@2',
    createdAt: new Date().toISOString(),
    terms: terms.trim(),
    evidence,
    publicEvidence: {
      url: publicEvidenceUrl.trim(),
      sha256: publicEvidenceSha256.trim().toLowerCase(),
    },
    verification: assessment.verification,
    preflight: {
      label: assessment.label,
      score: assessment.score,
      checks: assessment.checks,
      notice: 'EIP-191 signatures and embedded artifact bytes were verified locally. GenLayer validators independently adjudicate every mandatory SLA criterion.',
    },
  };
}

export function serializeEvidencePacket(packet) {
  const content = { ...packet };
  delete content.caseHash;
  delete content.evidenceHash;
  return canonicalize(content);
}

export async function hashEvidencePacket(packet) {
  return sha256Hex(serializeEvidencePacket(packet));
}
