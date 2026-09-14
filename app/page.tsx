'use client';

import { useState } from 'react';

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

type Verdict = {
  label: 'CONSENSUS READY' | 'NEEDS EVIDENCE';
  score: number;
  hash: string;
  checks: { label: string; pass: boolean }[];
};

export default function Home() {
  const [terms, setTerms] = useState(sampleTerms);
  const [evidence, setEvidence] = useState(sampleEvidence);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [packet, setPacket] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  async function runPreflight() {
    setRunning(true);
    setError('');
    try {
      const parsed = JSON.parse(evidence) as Record<string, unknown>;
      const assessment = analyzeEvidence(terms, parsed);
      const evidencePacket = buildEvidencePacket(terms, parsed, assessment);
      const hash = await hashEvidencePacket(evidencePacket);
      setVerdict({
        label: assessment.label,
        score: assessment.score,
        hash,
        checks: assessment.checks,
      });
      setPacket({ ...evidencePacket, caseHash: hash });
    } catch {
      setError('The evidence bundle is not valid JSON. Fix it and run the check again.');
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
            Turn agent logs and deliverables into a tamper-evident evidence pack,
            then let GenLayer validators adjudicate the SLA from the same public rules.
          </p>
        </div>
        <aside className="signal-card" aria-label="Protocol summary">
          <div className="signal-top"><span>PROTOCOL</span><strong>01 / 03</strong></div>
          <div className="signal-orbit" aria-hidden="true"><i /><b /><em /></div>
          <div className="signal-stats">
            <div><span>INPUT</span><strong>Signed evidence</strong></div>
            <div><span>OUTPUT</span><strong>Consensus verdict</strong></div>
          </div>
        </aside>
      </section>

      <section className="workbench" aria-labelledby="workbench-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow"><span>02</span> Evidence workbench</p>
            <h2 id="workbench-title">Build a consensus-ready case</h2>
          </div>
          <p>This local pre-flight never sends your data anywhere.</p>
        </div>

        <div className="work-grid">
          <section className="input-card">
            <label htmlFor="terms"><span>01</span> SLA terms</label>
            <p>Write objective rules the validators can apply.</p>
            <textarea id="terms" value={terms} onChange={(event) => setTerms(event.target.value)} />
            <div className="input-foot"><span>{terms.length} chars</span><strong>Plain language</strong></div>
          </section>

          <section className="input-card">
            <label htmlFor="evidence"><span>02</span> Evidence bundle</label>
            <p>Paste logs, hashes and delivery receipts as JSON.</p>
            <textarea className="code-input" id="evidence" value={evidence} onChange={(event) => setEvidence(event.target.value)} spellCheck={false} />
            <div className="input-foot"><span>JSON</span><strong>Canonicalized before hashing</strong></div>
          </section>

          <section className="verdict-card" aria-live="polite">
            <div className="verdict-head">
              <span>03 / PREFLIGHT</span>
              <span className={verdict?.label === 'CONSENSUS READY' ? 'state ready' : 'state'}>
                {verdict?.label ?? 'AWAITING INPUT'}
              </span>
            </div>
            <div className="score-wrap">
              <div className="score"><strong>{verdict?.score ?? '—'}</strong><span>/100</span></div>
              <p>{verdict ? 'Evidence completeness score' : 'Run a local check before sending the case to consensus.'}</p>
            </div>
            <div className="check-list">
              {(verdict?.checks ?? [
                { label: 'Machine-readable evidence', pass: false },
                { label: 'Signed event trail', pass: false },
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
            <small>Local result ≠ final verdict. GenLayer consensus is the adjudication layer.</small>
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
        </div>
        <div className="contract-code" aria-label="Intelligent Contract excerpt">
          <div><span>AGENT_SLA_JUDGE.PY</span><b>GENVM / PYTHON</b></div>
          <pre><code>{`def judge_case() -> str:
    public_context = gl.nondet.web.render(
        case.public_evidence_url, mode="text"
    )
    verdict = gl.nondet.exec_prompt(
        rubric + evidence + public_context,
        response_format="json",
    )
    return json.dumps(verdict, sort_keys=True)

result = gl.eq_principle.strict_eq(judge_case)`}</code></pre>
          <p><span>●</span> Evidence is data, never instruction.</p>
        </div>
      </section>

      <section className="method" id="how-it-works">
        <p className="eyebrow"><span>04</span> From promise to proof</p>
        <div className="method-grid">
          {[
            ['01', 'Define', 'Translate the deal into explicit, machine-readable success rules.'],
            ['02', 'Bundle', 'Normalize signed logs, receipts, artifacts and public evidence.'],
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
