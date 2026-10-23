# AgentSLA

AgentSLA turns service terms, signed agent events, and content-addressed artifacts into an evidence packet that GenLayer validators adjudicate criterion by criterion.

Built for the **GenLayer Agent Tank — Agentic Commerce Infrastructure** track.

## Security model

AgentSLA V2 treats evidence as untrusted until all of these gates pass:

1. Every event carries an EIP-191 signature from an explicitly authorized address.
2. The browser independently recovers every signer before enabling submission.
3. The Intelligent Contract independently performs secp256k1 recovery with GenVM's Keccak-256 implementation and requires every signer to equal the transaction sender.
4. Every inline artifact contains its exact bytes; both the browser and contract recompute its SHA-256.
5. Optional public evidence is accepted only as a public HTTPS URL plus an expected SHA-256. Validators fetch the bytes and mark them unverified if the HTTP request or hash check fails.
6. The complete canonical `agentsla/evidence-pack@2` JSON is SHA-256 anchored onchain.
7. Validators return one outcome for every criterion. The contract derives the final result from mandatory criteria: any `FAIL` fails the case, any unresolved mandatory criterion yields `NEEDS_REVIEW`, and only all-mandatory `PASS` produces `PASS`.

The local score is only a cryptographic and completeness gate. It is labeled `VERIFIED FOR REVIEW`; it is never presented as proof that the SLA itself passed.

## Architecture

```text
Connected EIP-1193 wallet
    │  personal_sign each canonical event
    ▼
AgentSLA web app
    │  recover signer + recompute artifact/public SHA-256
    │  create canonical evidence-pack@2 + exact packet hash
    ▼
AgentSLAJudge Intelligent Contract
    │  recover every EIP-191 signer again
    │  recompute packet/artifact/public-evidence hashes
    │  prompt_comparative per criterion
    ▼
PASS / FAIL / NEEDS_REVIEW + per-criterion results
```

Submitted terms and evidence are delimited as untrusted data in the validator prompt. They cannot replace the contract's adjudication instructions.

## What changed in V2

- Removed temporary `createAccount()` transaction signers; all writes use the connected EIP-1193 wallet.
- Added event-level EIP-191 signatures and signer authorization.
- Added independent browser and onchain secp256k1 recovery.
- Added embedded artifact bytes and deterministic SHA-256 verification.
- Added hash-checked optional public evidence.
- Anchored the exact serialized packet, including creation time and verification results.
- Replaced one bundle-level verdict with mandatory criterion-by-criterion consensus.
- Added negative tests for tampered events, altered artifact bytes, incorrect packet hashes, unauthorized signers, missing evidence references, forged recovery results, duplicate cases, and unauthorized adjudication.
- Updated the contract runtime pin to GenVM `v0.6.0-rc3`.

The detailed reviewer mapping is in [`docs/REVIEWER_RESPONSE.md`](docs/REVIEWER_RESPONSE.md).

## Run the app

Requirements: Node.js 22.13 or newer.

```bash
npm install
copy .env.example .env.local
npm run dev
```

The finalized Studio Dev V2 address is built in as the reviewed default. `NEXT_PUBLIC_AGENT_SLA_CONTRACT_ADDRESS` can override it for another verified deployment. The legacy V1 address is intentionally not used because its method signature and evidence guarantees are incompatible with V2.

The normal workflow is:

1. Define explicit SLA criteria and reference event IDs.
2. Attach the exact artifact files (8 KiB maximum per inline artifact).
3. Connect the case-owner wallet and sign every event.
4. Optionally fetch and hash public evidence (2 MiB browser limit).
5. Run the evidence check and download the packet.
6. Submit and adjudicate only against a verified V2 deployment.

## Tests

```bash
npm test
npm run lint
npm run build
```

For the Intelligent Contract:

```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\pytest tests/direct -v
.venv\Scripts\genvm-lint contracts/agent_sla_judge.py
```

The Python dependencies pin the official GenLayer `0.19.0rc2` client and `0.30.0rc2` testing stack required by the V2 GenVM runner.

## Contract API

```text
submit_case(
  case_id,
  terms,
  exact_evidence_packet_json,
  evidence_packet_sha256,
  public_evidence_url,
  public_evidence_sha256,
)
adjudicate(case_id)
get_case(case_id)
```

`get_case` returns the owner, exact evidence packet, anchored packet hash, public-evidence metadata, final status, score, reason, and serialized per-criterion results.

## Deployment status

The previously published V1 contract and demo transaction remain historical evidence of the earlier prototype, but they do **not** implement V2 guarantees and are no longer wired into the app.

The V2 source and tests are complete. The reviewed contract was deployed successfully on Studio Dev (chain 61997) on October 22, 2026:

- Contract: [`0x025A22401c73c27F3DfE45e3CC3295CC2cbae4c0`](https://explorer-studio-dev.genlayer.com/address/0x025A22401c73c27F3DfE45e3CC3295CC2cbae4c0)
- Deployment transaction: [`0xde69da1619240181a3f299286c7144708d1d927bd25241d52932fea50ca5d89a`](https://explorer-studio-dev.genlayer.com/tx/0xde69da1619240181a3f299286c7144708d1d927bd25241d52932fea50ca5d89a) (`FINALIZED`, GenVM `SUCCESS`, consensus `Accepted`)

Finalized sample `submit_case` and `adjudicate` transactions and the portal resubmission remain pending because they require additional wallet signatures.

## Scope

AgentSLA adjudicates evidence; it does not custody funds. Escrow or payment adapters can consume the stored consensus result separately.

## License

MIT
