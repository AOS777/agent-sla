'use client';

import { useEffect, useState } from 'react';
import { createClient, isSuccessful } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';
import { getAddress, stringToHex, type EIP1193Provider } from 'viem';

import {
  analyzeEvidence,
  buildEventSigningMessage,
  buildEvidencePacket,
  fetchAndHashPublicEvidence,
  hashEvidencePacket,
  serializeEvidencePacket,
  sha256Hex,
} from '@/lib/evidence.mjs';

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

const sampleTerms = `Service: Atlas research agent
Window: 14 Sep 2026, 08:00–08:30 UTC
Required output: report.json and summary.md
Success threshold: at least 3 signed events, no failed health checks, latency below 2000 ms
Decision rule: PASS only when every requirement is supported by the evidence bundle.`;

const sampleEvidence = JSON.stringify(
  {
    service: 'atlas-research-agent',
    window: {
      start: '2026-09-14T08:00:00Z',
      end: '2026-09-14T08:30:00Z',
    },
    authorizedSigners: [],
    criteria: [
      {
        id: 'availability',
        description: 'Every recorded health check must return a successful status.',
        required: true,
        evidenceEventIds: ['health-1'],
      },
      {
        id: 'latency',
        description: 'Every recorded health check must complete in less than 2000 ms.',
        required: true,
        evidenceEventIds: ['health-1'],
      },
      {
        id: 'deliverables',
        description: 'Both required artifacts must match their declared SHA-256 hashes.',
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
        latencyMs: 842,
      },
      {
        id: 'artifact-report',
        at: '2026-09-14T08:14:09Z',
        type: 'artifact',
        name: 'report.json',
        sha256: '7df4c3a5d2d577e3d08a941a2c77ba83defcee03618320b2e3643854336df3e4',
        contentBase64: 'eyJhbnN3ZXIiOjQyfQo=',
      },
      {
        id: 'artifact-summary',
        at: '2026-09-14T08:22:31Z',
        type: 'artifact',
        name: 'summary.md',
        sha256: '814f757ba9319f551efceb153ace1761777b9e705361071dcc7419902aba0e71',
        contentBase64: 'IyBTdW1tYXJ5CkNvbXBsZXRlZC4K',
      },
    ],
  },
  null,
  2,
);

const deployedV2ContractAddress = '0x025A22401c73c27F3DfE45e3CC3295CC2cbae4c0';
const configuredContractAddress =
  process.env.NEXT_PUBLIC_AGENT_SLA_CONTRACT_ADDRESS?.trim() || deployedV2ContractAddress;
const contractAddress = /^0x[0-9a-fA-F]{40}$/.test(configuredContractAddress)
  ? getAddress(configuredContractAddress)
  : null;
const explorerAddressUrl = contractAddress
  ? `https://explorer-studio-dev.genlayer.com/address/${contractAddress}`
  : '';
const explorerTxBase = 'https://explorer-studio-dev.genlayer.com/tx/';
const readClient = createClient({ chain: studioDevnet });

type Verdict = {
  label: 'VERIFIED FOR REVIEW' | 'NEEDS EVIDENCE';
  score: number;
  hash: string;
  checks: { label: string; pass: boolean }[];
};

type ChainCase = {
  case_id: string;
  owner: string;
  status: string;
  score: string;
  reason: string;
  evidence_hash: string;
  criteria_results: string;
};

type ContractHealth = {
  state: 'CHECKING' | 'LIVE' | 'NOT_DEPLOYED' | 'UNREACHABLE';
  detail: string;
};

export default function Home() {
  const [terms, setTerms] = useState(sampleTerms);
  const [evidence, setEvidence] = useState(sampleEvidence);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [packet, setPacket] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [publicEvidenceUrl, setPublicEvidenceUrl] = useState('');
  const [publicEvidenceSha256, setPublicEvidenceSha256] = useState('');
  const [publicEvidenceVerified, setPublicEvidenceVerified] = useState(false);
  const [publicEvidenceStatus, setPublicEvidenceStatus] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [walletBusy, setWalletBusy] = useState(false);
  const [contractHealth, setContractHealth] = useState<ContractHealth>({
    state: contractAddress ? 'CHECKING' : 'NOT_DEPLOYED',
    detail: contractAddress
      ? 'Reading contract schema from Studio Dev…'
      : 'V2 contract address is intentionally unset until the reviewed build is deployed.',
  });
  const [chainBusy, setChainBusy] = useState<'SUBMIT' | 'ADJUDICATE' | null>(null);
  const [chainError, setChainError] = useState('');
  const [chainCase, setChainCase] = useState<ChainCase | null>(null);
  const [chainTx, setChainTx] = useState('');
  function invalidateDraft() {
    setVerdict(null);
    setPacket(null);
    setError('');
    setChainCase(null);
    setChainTx('');
    setChainError('');
  }

  function invalidatePublicEvidence() {
    setPublicEvidenceSha256('');
    setPublicEvidenceVerified(false);
    setPublicEvidenceStatus('');
    invalidateDraft();
  }

  useEffect(() => {
    let active = true;

    if (!contractAddress) return () => { active = false; };

    readClient.getContractSchema(contractAddress)
      .then((schema) => {
        if (!active) return;
        const methods = Object.keys(schema.methods);
        const ready = ['submit_case', 'adjudicate', 'get_case'].every((name) => methods.includes(name));
        setContractHealth(ready
          ? { state: 'LIVE', detail: 'Chain 61997 · 3 contract methods verified' }
          : { state: 'UNREACHABLE', detail: 'Contract schema did not match the AgentSLA interface.' });
      })
      .catch(() => {
        if (active) setContractHealth({ state: 'UNREACHABLE', detail: 'Studio Dev RPC is temporarily unavailable.' });
      });

    return () => { active = false; };
  }, []);

  async function connectWallet() {
    const provider = window.ethereum;
    if (!provider) throw new Error('No EIP-1193 wallet was detected. Install or open your wallet extension.');
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') {
      throw new Error('The wallet did not return an account.');
    }
    const address = getAddress(accounts[0]);
    const writer = createClient({ chain: studioDevnet, account: address, provider });
    await writer.connect('studioDevnet');
    setWalletAddress(address);
    return { address, provider, writer };
  }

  async function connectWalletFromButton() {
    setWalletBusy(true);
    setError('');
    try {
      await connectWallet();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not connect the wallet.');
    } finally {
      setWalletBusy(false);
    }
  }

  async function signEvidenceEvents() {
    setWalletBusy(true);
    setError('');
    try {
      const parsed = JSON.parse(evidence) as Record<string, unknown> & { events?: Record<string, unknown>[] };
      if (!Array.isArray(parsed.events) || parsed.events.length < 1) {
        throw new Error('Add event records before signing.');
      }
      const { address, provider } = await connectWallet();
      parsed.authorizedSigners = [{ address, role: 'agent-operator' }];
      for (const event of parsed.events) {
        event.signer = { address, scheme: 'eip191' };
        const message = buildEventSigningMessage(parsed, event);
        const signature = await provider.request({
          method: 'personal_sign',
          params: [stringToHex(message), address],
        });
        if (typeof signature !== 'string') throw new Error('The wallet returned an invalid signature.');
        event.signer = { address, scheme: 'eip191', signature };
      }
      setEvidence(JSON.stringify(parsed, null, 2));
      invalidateDraft();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign the evidence events.');
    } finally {
      setWalletBusy(false);
    }
  }

  async function attachArtifactFiles(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    try {
      const parsed = JSON.parse(evidence) as Record<string, unknown> & { events?: Record<string, unknown>[] };
      if (!Array.isArray(parsed.events)) throw new Error('The evidence bundle has no event list.');
      const byName = new Map(Array.from(files).map((file) => [file.name, file]));
      let matched = 0;
      for (const event of parsed.events) {
        if (event.type !== 'artifact' || typeof event.name !== 'string') continue;
        const file = byName.get(event.name);
        if (!file) continue;
        if (file.size > 8192) throw new Error(`${file.name} exceeds the 8 KiB onchain evidence limit.`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        event.contentBase64 = btoa(binary);
        event.sha256 = await sha256Hex(bytes);
        delete event.signer;
        matched += 1;
      }
      if (matched === 0) throw new Error('No selected file name matched an artifact event name.');
      setEvidence(JSON.stringify(parsed, null, 2));
      invalidateDraft();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not attach the artifact files.');
    }
  }

  async function verifyPublicEvidence() {
    setRunning(true);
    setError('');
    setPublicEvidenceStatus('');
    try {
      const result = await fetchAndHashPublicEvidence(publicEvidenceUrl.trim());
      setPublicEvidenceSha256(result.sha256);
      setPublicEvidenceVerified(true);
      setPublicEvidenceStatus(`${result.size} bytes · SHA-256 verified`);
      invalidateDraft();
    } catch (caught) {
      setPublicEvidenceSha256('');
      setPublicEvidenceVerified(false);
      setError(caught instanceof Error ? caught.message : 'Could not verify the public evidence.');
    } finally {
      setRunning(false);
    }
  }

  async function runPreflight() {
    setRunning(true);
    setError('');
    try {
      const parsed = JSON.parse(evidence) as Record<string, unknown>;
      const assessment = await analyzeEvidence(terms, parsed, {
        url: publicEvidenceUrl,
        sha256: publicEvidenceSha256,
        verified: publicEvidenceVerified,
      });
      const evidencePacket = buildEvidencePacket(
        terms,
        parsed,
        assessment,
        publicEvidenceUrl,
        publicEvidenceSha256,
      );
      const hash = await hashEvidencePacket(evidencePacket);
      setVerdict({
        label: assessment.label,
        score: assessment.score,
        hash,
        checks: assessment.checks,
      });
      setPacket(evidencePacket);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The evidence bundle could not be verified.');
      setVerdict(null);
      setPacket(null);
    } finally {
      setRunning(false);
    }
  }

  function downloadPacket() {
    if (!packet || !verdict) return;
    const blob = new Blob([JSON.stringify({ ...packet, evidenceHash: verdict.hash }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `agentsla-${verdict.hash.slice(0, 12)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function fetchChainCase(caseId: string): Promise<ChainCase> {
    if (!contractAddress) throw new Error('The reviewed V2 contract has not been deployed yet.');
    const value = await readClient.readContract({
      address: contractAddress,
      functionName: 'get_case',
      args: [caseId],
      transactionHashVariant: TransactionHashVariant.LATEST_NONFINAL,
    });
    const record = value as Record<string, unknown>;
    return {
      case_id: String(record.case_id ?? caseId),
      owner: String(record.owner ?? ''),
      status: String(record.status ?? ''),
      score: String(record.score ?? '0'),
      reason: String(record.reason ?? ''),
      evidence_hash: String(record.evidence_hash ?? ''),
      criteria_results: String(record.criteria_results ?? '[]'),
    };
  }

  async function readChainCase(caseId: string) {
    setChainCase(await fetchChainCase(caseId));
  }

  async function submitToGenLayer() {
    if (!packet || !verdict || verdict.label !== 'VERIFIED FOR REVIEW') return;
    setChainBusy('SUBMIT');
    setChainError('');
    try {
      if (!contractAddress) throw new Error('The reviewed V2 contract has not been deployed yet.');
      const caseId = `sla-${verdict.hash.slice(0, 24)}`;
      const { address, writer } = await connectWallet();
      const packetJson = serializeEvidencePacket(packet);
      const writeRequest = {
        account: address,
        address: contractAddress,
        functionName: 'submit_case',
        args: [
          caseId,
          String(packet.terms),
          packetJson,
          verdict.hash,
          publicEvidenceUrl.trim(),
          publicEvidenceSha256.trim().toLowerCase(),
        ],
      };
      const estimate = await writer.estimateTransactionFeesForWrite(writeRequest);
      const txId = await writer.writeContract({
        ...writeRequest,
        fees: { distribution: estimate.distribution, feeValue: estimate.feeValue },
      });
      const receipt = await writer.waitForFinalization({ hash: txId, interval: 1000, retries: 180 });
      if (!isSuccessful(receipt)) throw new Error('The network did not accept the case.');
      setChainTx(String(txId));
      await readChainCase(caseId);
    } catch (caught) {
      setChainError(caught instanceof Error ? caught.message : 'Could not submit the case to GenLayer.');
    } finally {
      setChainBusy(null);
    }
  }

  async function adjudicateOnGenLayer() {
    if (!chainCase?.case_id || chainCase.status !== 'PENDING') return;
    setChainBusy('ADJUDICATE');
    setChainError('');
    try {
      if (!contractAddress) throw new Error('The reviewed V2 contract has not been deployed yet.');
      const { address, writer } = await connectWallet();
      if (chainCase.owner && chainCase.owner.toLowerCase() !== address.toLowerCase()) {
        throw new Error('Connect the same wallet that owns this case.');
      }
      const writeRequest = {
        account: address,
        address: contractAddress,
        functionName: 'adjudicate',
        args: [chainCase.case_id],
      };
      const estimate = await writer.estimateTransactionFeesForWrite(writeRequest);
      const txId = await writer.writeContract({
        ...writeRequest,
        fees: { distribution: estimate.distribution, feeValue: estimate.feeValue },
      });
      const receipt = await writer.waitForFinalization({ hash: txId, interval: 1000, retries: 240 });
      if (!isSuccessful(receipt)) throw new Error('Consensus did not accept the adjudication.');
      setChainTx(String(txId));
      await readChainCase(chainCase.case_id);
    } catch (caught) {
      setChainError(caught instanceof Error ? caught.message : 'Could not run GenLayer adjudication.');
    } finally {
      setChainBusy(null);
    }
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="AgentSLA home">
          <span className="brand-mark" aria-hidden="true"><i /><b /></span>
          <span>AGENT<span>SLA</span></span>
        </a>
        <div className="top-meta">
          <span className="live-dot" />
          Built for GenLayer Agent Tank
        </div>
        <a className="text-link" href="#how-it-works">How it works <span>↘</span></a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span>01</span> Trust infrastructure for agent commerce</p>
          <h1>Prove the service.<br /><em>Release the trust.</em></h1>
          <p className="lede">
            Turn agent logs and deliverables into a hash-linked evidence pack,
            then let GenLayer validators adjudicate the SLA from the same public rules.
          </p>
        </div>
        <aside className="signal-card" aria-label="Protocol summary">
          <div className="signal-top"><span>PROTOCOL</span><strong>01 / 03</strong></div>
          <div className="signal-orbit" aria-hidden="true"><i /><b /><em /></div>
          <div className="signal-stats">
            <div><span>INPUT</span><strong>JSON evidence</strong></div>
            <div><span>OUTPUT</span><strong>Consensus verdict</strong></div>
          </div>
        </aside>
      </section>

      <section className="workbench" aria-labelledby="workbench-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><span>02</span> Evidence workbench</p>
            <h2 id="workbench-title">Build a case for validator review</h2>
          </div>
          <p>Pre-flight stays local except when you explicitly fetch an optional public evidence URL.</p>
        </div>

        <div className="work-grid">
          <section className="input-card">
            <label htmlFor="terms"><span>01</span> SLA terms</label>
            <p>Write objective rules the validators can apply.</p>
            <textarea id="terms" value={terms} onChange={(event) => { setTerms(event.target.value); invalidateDraft(); }} />
            <div className="input-foot"><span>{terms.length} chars</span><strong>Plain language</strong></div>
          </section>

          <section className="input-card">
            <label htmlFor="evidence"><span>02</span> Evidence bundle</label>
            <p>Paste criteria and event records, attach artifact bytes, then sign every event with the case-owner wallet.</p>
            <textarea className="code-input" id="evidence" value={evidence} onChange={(event) => { setEvidence(event.target.value); invalidateDraft(); }} spellCheck={false} />
            <div className="evidence-actions">
              <button className="download-button" type="button" onClick={connectWalletFromButton} disabled={walletBusy}>
                {walletAddress ? `WALLET ${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'CONNECT EIP-1193 WALLET'}
              </button>
              <button className="download-button" type="button" onClick={signEvidenceEvents} disabled={walletBusy}>
                {walletBusy ? 'WAITING FOR WALLET…' : 'SIGN EVERY EVENT'}
              </button>
              <label className="file-button" htmlFor="artifact-files">ATTACH ARTIFACT FILES</label>
              <input
                id="artifact-files"
                type="file"
                multiple
                onChange={(event) => { void attachArtifactFiles(event.target.files); event.target.value = ''; }}
              />
            </div>
            <label className="url-label" htmlFor="public-evidence">Optional public evidence URL</label>
            <input
              id="public-evidence"
              type="url"
              value={publicEvidenceUrl}
              onChange={(event) => { setPublicEvidenceUrl(event.target.value); invalidatePublicEvidence(); }}
              placeholder="https://raw.githubusercontent.com/.../proof.json"
            />
            {publicEvidenceUrl && (
              <button className="download-button" type="button" onClick={verifyPublicEvidence} disabled={running}>
                {running ? 'HASHING PUBLIC EVIDENCE…' : 'FETCH + VERIFY PUBLIC EVIDENCE'}
              </button>
            )}
            {publicEvidenceSha256 && <div className="hash"><span>PUBLIC EVIDENCE SHA-256</span><code>{publicEvidenceSha256}</code></div>}
            {publicEvidenceStatus && <p className="verified-note">{publicEvidenceStatus}</p>}
            <div className="input-foot"><span>EIP-191 + SHA-256</span><strong>Canonicalized before anchoring</strong></div>
          </section>

          <section className="verdict-card" aria-live="polite">
            <div className="verdict-head">
              <span>03 / PREFLIGHT</span>
              <span className={verdict?.label === 'VERIFIED FOR REVIEW' ? 'state ready' : 'state'}>
                {verdict?.label ?? 'AWAITING INPUT'}
              </span>
            </div>
            <div className="score-wrap">
              <div className="score"><strong>{verdict?.score ?? '—'}</strong><span>/100</span></div>
              <p>{verdict ? 'Cryptographic pre-flight score — GenLayer still decides SLA fulfillment' : 'Verify signatures, bytes, hashes, and criterion references before consensus.'}</p>
            </div>
            <div className="check-list">
              {(verdict?.checks ?? [
                { label: 'Machine-readable evidence', pass: false },
                { label: 'Event records', pass: false },
                { label: 'Objective decision criteria', pass: false },
              ]).map((check) => (
                <div key={check.label}><span className={check.pass ? 'check pass' : 'check'}>{check.pass ? '✓' : '·'}</span>{check.label}</div>
              ))}
            </div>
            {verdict && <div className="hash"><span>CASE HASH</span><code>{verdict.hash}</code></div>}
            {error && <p className="error" role="alert">{error}</p>}
            <button className="run-button" type="button" onClick={runPreflight} disabled={running}>
              <span>{running ? 'CHECKING…' : 'RUN EVIDENCE CHECK'}</span><b>→</b>
            </button>
            {packet && <button className="download-button" type="button" onClick={downloadPacket}>DOWNLOAD EVIDENCE PACK ↓</button>}
            {packet && verdict?.label === 'VERIFIED FOR REVIEW' && !chainCase && (
              <button className="chain-button" type="button" onClick={submitToGenLayer} disabled={chainBusy !== null || contractHealth.state !== 'LIVE'}>
                {chainBusy === 'SUBMIT' ? 'WAITING FOR FINALIZATION…' : 'SUBMIT HASH-ANCHORED CASE ↗'}
              </button>
            )}
            {chainCase?.status === 'PENDING' && (
              <button className="chain-button" type="button" onClick={adjudicateOnGenLayer} disabled={chainBusy !== null}>
                {chainBusy === 'ADJUDICATE' ? 'VALIDATORS ARE JUDGING…' : 'RUN CONSENSUS ADJUDICATION ↗'}
              </button>
            )}
            {chainCase && (
              <div className="chain-result">
                <span>ONCHAIN CASE · {chainCase.status}</span>
                <strong>{chainCase.score}/100</strong>
                <p>{chainCase.reason}</p>
                <code>{chainCase.evidence_hash}</code>
              </div>
            )}
            {chainTx && <a className="tx-link" href={`${explorerTxBase}${chainTx}`} target="_blank" rel="noreferrer">VIEW LATEST TRANSACTION ↗</a>}
            {chainError && <p className="error" role="alert">{chainError}</p>}
            <small>Local checks recover every EIP-191 signer and recompute artifact/public-evidence SHA-256 values. The connected wallet signs all writes; GenLayer derives the final outcome from every mandatory criterion. Studio Dev testnet fees may apply.</small>
          </section>
        </div>
      </section>

      <section className="contract-section" id="contract">
        <div className="contract-copy">
          <p className="eyebrow"><span>03</span> GenLayer adjudication</p>
          <h2>One rubric.<br /><em>Many validators.</em></h2>
          <p>
            The Intelligent Contract stores the exact evidence hash, recomputes embedded
            artifact hashes, verifies optional public bytes, and commits a result only
            after validators agree criterion by criterion.
          </p>
          <div className="verdict-types">
            <span>PASS</span><span>FAIL</span><span>NEEDS_REVIEW</span>
          </div>
          {contractAddress ? (
            <a className="deployment-card" href={explorerAddressUrl} target="_blank" rel="noreferrer">
              <span className={`deployment-state ${contractHealth.state.toLowerCase()}`}>{contractHealth.state}</span>
              <div><small>STUDIO DEV · CHAIN 61997</small><strong>{contractAddress}</strong><p>{contractHealth.detail}</p></div>
              <b>↗</b>
            </a>
          ) : (
            <div className="deployment-card">
              <span className="deployment-state not_deployed">NOT DEPLOYED</span>
              <div><small>STUDIO DEV · CHAIN 61997</small><strong>V2 deployment pending</strong><p>{contractHealth.detail}</p></div>
            </div>
          )}
        </div>
        <div className="contract-code" aria-label="Intelligent Contract excerpt">
          <div><span>AGENT_SLA_JUDGE.PY</span><b>GENVM / PYTHON</b></div>
          <pre><code>{`evidence_hash = sha256(packet_bytes)
assert evidence_hash == submitted_hash

results = prompt_comparative(
    judge_each_required_criterion,
    "Every criterion outcome must match",
)

outcome = derive_from_required(results)`}</code></pre>
          <p><span>●</span> Exact bytes anchored. Mandatory criteria enforced.</p>
        </div>
      </section>

      <section className="method" id="how-it-works">
        <p className="eyebrow"><span>04</span> From promise to proof</p>
        <div className="method-grid">
          {[
            ['01', 'Define', 'Translate the deal into explicit, machine-readable success rules.'],
            ['02', 'Verify', 'Recover every event signer and recompute every attached artifact hash.'],
            ['03', 'Adjudicate', 'Validators agree on each mandatory criterion before deriving the final outcome.'],
          ].map(([number, title, copy]) => (
            <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>
          ))}
        </div>
      </section>

      <footer>
        <span>AGENT<span>SLA</span> / 2026</span>
        <p>Portable proof for autonomous work.</p>
        <a href="#contract">Intelligent Contract ↑</a>
      </footer>
    </main>
  );
}
