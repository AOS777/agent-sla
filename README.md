# AgentSLA

AgentSLA turns service terms, agent event records, and artifact receipts into a portable evidence pack that can be adjudicated by GenLayer validators.

Built for the **GenLayer Agent Tank — Agentic Commerce Infrastructure** track.

## The problem

Autonomous agents can pay each other, but a payment rail alone cannot answer whether the work was actually completed. Logs are inconsistent, deliverables can change after submission, and one platform's verdict does not travel to another.

AgentSLA separates the problem into two layers:

1. **Evidence preparation** — the web app normalizes terms and evidence, checks completeness, and produces a canonical SHA-256 case hash.
2. **Consensus adjudication** — the Intelligent Contract asks GenLayer validators to apply the same SLA rubric and agree on `PASS`, `FAIL`, or `NEEDS_REVIEW`.

The local pre-flight result is deliberately labeled as non-final. Only the Intelligent Contract produces the final consensus verdict.

## What works

- Editable plain-language SLA terms
- JSON evidence bundles with event records, health checks, latency, and artifact-hash claims
- Deterministic completeness checks
- Canonical SHA-256 case hash
- Downloadable `agentsla/evidence-pack@1` JSON packet
- Live GenLayerJS connection to Studio Dev chain `61997`
- Onchain case submission, consensus adjudication, and result reads
- GenLayer Intelligent Contract for case storage and validator consensus
- Direct-mode contract tests and dependency-free web logic tests

## Architecture

```text
Agent / buyer
    │
    ├─ SLA terms + event records + artifact-hash claims
    ▼
AgentSLA web app
    │  canonicalize → pre-flight → SHA-256 evidence pack
    ▼
AgentSLAJudge Intelligent Contract
    │  prompt_comparative over validator LLM verdicts (+ optional public web evidence)
    ▼
PASS / FAIL / NEEDS_REVIEW + score + reason
```

The contract treats submitted and web-fetched content as untrusted evidence. Evidence cannot override the adjudication rubric in the validator prompt.

## Run the web app

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, keep the included sample, and click **Run evidence check**. The sample returns a 100/100 `READY FOR REVIEW` structural pre-flight result and a case hash. This does **not** verify signatures, signer identity, artifact hashes, or SLA compliance. Edit a health-check status to `503` to see the structural gate fail. Editing the inputs invalidates the prior pre-flight result. The case hash covers the terms, evidence, and public evidence URL, but not the packet creation time or local pre-flight wording.

## Test

```bash
npm test
npm run build
```

For the Intelligent Contract, install the current official GenLayer testing stack and run:

```bash
python -m pip install -r requirements.txt
pytest tests/direct -v
genvm-lint check contracts/agent_sla_judge.py
```

## Intelligent Contract flow

1. Call `submit_case(case_id, terms, evidence_json, public_evidence_url)`.
2. Call `adjudicate(case_id)`.
3. Read `get_case(case_id)` to obtain the consensus outcome, score, and reason.

The optional public evidence URL is rendered inside GenVM. Validators receive the same terms, submitted evidence bundle, and public context. `prompt_comparative` independently compares validator conclusions and requires the outcome to match exactly.

## Verified deployment

- Network: Studio Dev (`chain 61997`)
- Contract: [`0xF5099d57F3e391B0cC3BBb7abC5AEe7a346f1338`](https://explorer-studio-dev.genlayer.com/address/0xF5099d57F3e391B0cC3BBb7abC5AEe7a346f1338)
- Deploy transaction: [`0x60c7f37c36712ddd29c583ea9358b4d6bff70e0821a6db0a5e5384182ce5dcd0`](https://explorer-studio-dev.genlayer.com/tx/0x60c7f37c36712ddd29c583ea9358b4d6bff70e0821a6db0a5e5384182ce5dcd0)
- Live web app: [AgentSLA](https://agent-sla-aos.aos777aos.chatgpt.site/)
- Finalized adjudication transaction: [`0xc172e5aa...e14351`](https://explorer-studio-dev.genlayer.com/tx/0xc172e5aa6c4bfd90c8a52f9f18127562de01a29528d235061538ed8fe3e14351)
- Read-only demo case: `sla-e1aced6d0a10732462a1bcaf` (stored `NEEDS_REVIEW`, 40/100). The sample's bundle-level `signedBy` claim did not establish three individually signed events; this is a demonstration of the gap between structural checks and validator judgment, not a successful SLA fulfillment.

## Scope and next step

This MVP adjudicates fulfillment but does not custody funds. It is designed to sit in front of an escrow or x402 payment adapter, which can release or dispute funds based on the stored consensus verdict.

## License

MIT
