'use client';

import { useEffect, useState } from 'react';
import { createAccount, createClient, isSuccessful } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';

import {
  analyzeEvidence,
  buildEvidencePacket,
  hashEvidencePacket,
} from '@/lib/evidence.mjs';

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
    events: [
      { at: '08:03:12Z', type: 'healthcheck', status: 200, latencyMs: 842 },
      { at: '08:14:09Z', type: 'artifact', name: 'report.json', sha256: '8b7d…f291' },
      { at: '08:22:31Z', type: 'artifact', name: 'summary.md', sha256: 'e241…a08c' },
    ],
    signedBy: 'agent:atlas-07',
  },
  null,
  2,
);

const contractAddress = '0xF5099d57F3e391B0cC3BBb7abC5AEe7a346f1338' as const;
const explorerAddressUrl = `https://explorer-studio-dev.genlayer.com/address/${contractAddress}`;
const explorerTxBase = 'https://explorer-studio-dev.genlayer.com/tx/';
const demoCaseId = 'sla-e1aced6d0a10732462a1bcaf';
const demoTx = '0xc172e5aa6c4bfd90c8a52f9f18127562de01a29528d235061538ed8fe3e14351';
const readClient = createClient({ chain: studioDevnet });

type Verdict = {
  label: 'READY FOR REVIEW' | 'NEEDS EVIDENCE';
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
};

type ContractHealth = {
  state: 'CHECKING' | 'LIVE' | 'UNREACHABLE';
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
  const [contractHealth, setContractHealth] = useState<ContractHealth>({
    state: 'CHECKING',
    detail: 'Reading contract schema from Studio Dev…',
  });
  const [chainBusy, setChainBusy] = useState<'SUBMIT' | 'ADJUDICATE' | null>(null);
  const [chainError, setChainError] = useState('');
  const [chainCase, setChainCase] = useState<ChainCase | null>(null);
  const [chainTx, setChainTx] = useState('');
  const [demoCase, setDemoCase] = useState<ChainCase | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState('');

  function invalidateDraft() {
    setVerdict(null);
    setPacket(null);
    setError('');
    setChainCase(null);
    setChainTx('');
    setChainError('');
  }

  useEffect(() => {
    let active = true;

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

  async function runPreflight() {
    setRunning(true);
    setError('');
    try {
      const parsed = JSON.parse(evidence) as Record<string, unknown>;
      const assessment = analyzeEvidence(terms, parsed);
      const evidencePacket = buildEvidencePacket(terms, parsed, assessment, publicEvidenceUrl);
      const hash = await hashEvidencePacket(evidencePacket);
      setVerdict({
        label: assessment.label,
        score: assessment.score,
        hash,
        checks: assessment.checks,
      });
      setPacket({ ...evidencePacket, caseHash: hash });
    } catch {
      setError('The evidence bundle must be a valid JSON object. Fix it and run the check again.');
      setVerdict(null);
      setPacket(null);
    } finally {
      setRunning(false);
    }
  }

  function downloadPacket() {
    if (!packet) return;
    const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `agentsla-${String(packet.caseHash).slice(0, 12)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function fetchChainCase(caseId: string): Promise<ChainCase> {
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
    };
  }

  async function readChainCase(caseId: string) {
    setChainCase(await fetchChainCase(caseId));
  }

  async function readDemoCase() {
    setDemoBusy(true);
    setDemoError('');
    try {
      setDemoCase(await fetchChainCase(demoCaseId));
    } catch {
      setDemoError('Could not read this case from Studio Dev. The transaction is still available in the explorer.');
    } finally {
      setDemoBusy(false);
    }
  }

  async function submitToGenLayer() {
    if (!packet || !verdict || verdict.label !== 'READY FOR REVIEW') return;
    setChainBusy('SUBMIT');
    setChainError('');
    try {
      const caseId = `sla-${verdict.hash.slice(0, 24)}`;
      const account = createAccount();
      const writer = createClient({ chain: studioDevnet, account });
      const writeRequest = {
        account,
        address: contractAddress,
        functionName: 'submit_case',
        args: [caseId, String(packet.terms), JSON.stringify(packet), String(packet.publicEvidenceUrl)],
      };
      const fees = await writer.estimateTransactionFeesForWrite(writeRequest);
      const txId = await writer.writeContract({ ...writeRequest, fees });
      const receipt = await writer.waitForDecision({ hash: txId, interval: 1000, retries: 120 });
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
      const account = createAccount();
      const writer = createClient({ chain: studioDevnet, account });
      const writeRequest = {
        account,
        address: contractAddress,
        functionName: 'adjudicate',
        args: [chainCase.case_id],
      };
      const fees = await writer.estimateTransactionFeesForWrite(writeRequest);
      const txId = await writer.writeContract({ ...writeRequest, fees });
      const receipt = await writer.waitForDecision({ hash: txId, interval: 1000, retries: 180 });
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
          <p>This local pre-flight never sends your data anywhere.</p>
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
            <p>Paste logs, hashes and delivery receipts as JSON.</p>
            <textarea className="code-input" id="evidence" value={evidence} onChange={(event) => { setEvidence(event.target.value); invalidateDraft(); }} spellCheck={false} />
            <label className="url-label" htmlFor="public-evidence">Optional public evidence URL</label>
            <input
              id="public-evidence"
              type="url"
              value={publicEvidenceUrl}
              onChange={(event) => { setPublicEvidenceUrl(event.target.value); invalidateDraft(); }}
              placeholder="https://example.com/public-proof"
            />
            <div className="input-foot"><span>JSON</span><strong>Canonicalized before hashing</strong></div>
          </section>

          <section className="verdict-card" aria-live="polite">
            <div className="verdict-head">
              <span>03 / PREFLIGHT</span>
              <span className={verdict?.label === 'READY FOR REVIEW' ? 'state ready' : 'state'}>
                {verdict?.label ?? 'AWAITING INPUT'}
              </span>
            </div>
            <div className="score-wrap">
              <div className="score"><strong>{verdict?.score ?? '—'}</strong><span>/100</span></div>
              <p>{verdict ? 'Structural completeness score — not a validity or consensus score' : 'Run a local check before sending the case to consensus.'}</p>
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
            {packet && verdict?.label === 'READY FOR REVIEW' && !chainCase && (
              <button className="chain-button" type="button" onClick={submitToGenLayer} disabled={chainBusy !== null || contractHealth.state !== 'LIVE'}>
                {chainBusy === 'SUBMIT' ? 'WAITING FOR CONSENSUS…' : 'SUBMIT CASE ONCHAIN ↗'}
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
              </div>
            )}
            {chainTx && <a className="tx-link" href={`${explorerTxBase}${chainTx}`} target="_blank" rel="noreferrer">VIEW LATEST TRANSACTION ↗</a>}
            {chainError && <p className="error" role="alert">{chainError}</p>}
            <small>Local checks do not verify signatures, signer identity, hashes, or claims. Only GenLayer consensus decides the SLA outcome. Onchain actions create an ephemeral account and may incur Studio Dev testnet fees.</small>
          </section>
        </div>
      </section>

      <section className="contract-section" id="contract">
        <div className="contract-copy">
          <p className="eyebrow"><span>03</span> GenLayer adjudication</p>
          <h2>One rubric.<br /><em>Many validators.</em></h2>
          <p>
            The Intelligent Contract stores the submitted case, renders optional public
            evidence, and uses the equivalence principle to commit a verdict only when
            validators agree on the same canonical JSON result.
          </p>
          <div className="verdict-types">
            <span>PASS</span><span>FAIL</span><span>NEEDS_REVIEW</span>
          </div>
          <a className="deployment-card" href={explorerAddressUrl} target="_blank" rel="noreferrer">
            <span className={`deployment-state ${contractHealth.state.toLowerCase()}`}>{contractHealth.state}</span>
            <div><small>STUDIO DEV · CHAIN 61997</small><strong>{contractAddress}</strong><p>{contractHealth.detail}</p></div>
            <b>↗</b>
          </a>
          <div className="demo-proof">
            <small>PUBLIC ONCHAIN DEMO · NO TRANSACTION REQUIRED</small>
            <p>Our sample packet passes local structure checks, but validators marked it NEEDS_REVIEW (40/100): a bundle-level signer claim does not prove three individually signed events.</p>
            <button type="button" onClick={readDemoCase} disabled={demoBusy || contractHealth.state !== 'LIVE'}>
              {demoBusy ? 'READING STUDIO DEV…' : 'READ THE STORED VERDICT ↗'}
            </button>
            {demoCase && <div className="demo-result"><strong>{demoCase.status} · {demoCase.score}/100</strong><p>{demoCase.reason}</p><code>{demoCase.case_id}</code></div>}
            {demoError && <p className="error" role="alert">{demoError}</p>}
            <a href={`${explorerTxBase}${demoTx}`} target="_blank" rel="noreferrer">VIEW FINALIZED ADJUDICATION TX ↗</a>
          </div>
        </div>
        <div className="contract-code" aria-label="Intelligent Contract excerpt">
          <div><span>AGENT_SLA_JUDGE.PY</span><b>GENVM / PYTHON</b></div>
          <pre><code>{`def judge_case() -> dict:
    context = gl.nondet.web.render(
        public_evidence_url, mode="text"
    )
    return gl.nondet.exec_prompt(
        rubric + evidence + context,
        response_format="json",
    )

result = gl.eq_principle.prompt_comparative(
    judge_case,
    "Outcome must match exactly",
)`}</code></pre>
          <p><span>●</span> Evidence is data, never instruction.</p>
        </div>
      </section>

      <section className="method" id="how-it-works">
        <p className="eyebrow"><span>04</span> From promise to proof</p>
        <div className="method-grid">
          {[
            ['01', 'Define', 'Translate the deal into explicit, machine-readable success rules.'],
            ['02', 'Bundle', 'Normalize event records, receipts, artifacts and public evidence.'],
            ['03', 'Adjudicate', 'Validators apply one rubric and agree on PASS, FAIL or REVIEW.'],
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
