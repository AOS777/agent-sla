# AgentSLA V2 reviewer response

This document maps the requested authenticity and blockchain-reliability changes to code and repeatable evidence. It records only transactions that are visibly finalized in Studio Dev and its explorer.

## 1. Event signatures and signer identity

- The connected EIP-1193 wallet signs a domain-separated canonical message for every event.
- `lib/evidence.mjs` recovers each address with `recoverMessageAddress` and rejects missing, changed, unauthorized, or malformed signatures.
- `contracts/agent_sla_judge.py` independently hashes the EIP-191 message with GenVM Keccak-256, recovers the secp256k1 public key, derives its address, and requires it to equal the case-owner transaction sender.
- Non-canonical high-`s` signatures and unsupported recovery IDs are rejected.

Evidence: `tests/web/evidence.test.mjs` and `tests/direct/test_agent_sla_judge.py`, especially the tampered-event, unauthorized-signer, and forged-recovery cases.

## 2. Artifact and external-evidence integrity

- Inline artifacts include their exact base64 bytes and declared SHA-256.
- The browser and contract independently recompute the digest.
- Optional public evidence requires a public HTTPS URL and expected SHA-256; URL credentials, loopback, private, link-local, carrier-grade NAT, multicast, and IPv6 literal targets are rejected.
- Validators fetch the public bytes and treat HTTP or digest mismatches as unverified evidence.

Evidence: the changed-artifact and public-evidence tests.

## 3. Exact evidence hash anchored onchain

- `serializeEvidencePacket` produces a canonical `agentsla/evidence-pack@2` JSON document.
- `submit_case` recomputes SHA-256 over the exact submitted UTF-8 JSON and rejects any mismatch.
- The exact JSON and hash are stored and returned by `get_case`.
- Display-only hash fields are excluded to avoid recursive hash changes.

Evidence: the exact-hash and tampered-hash tests.

## 4. Mandatory criteria enforced independently

- Every criterion has a unique ID, description, `required` flag, and references to existing event IDs.
- Validator output must contain exactly one result for every known criterion and no unknown IDs.
- The contract deterministically derives the overall result from required criteria; the model cannot directly choose the final bundle-level outcome.

Evidence: PASS, FAIL, and NEEDS_REVIEW direct-mode tests.

## 5. Connected-wallet blockchain flow

- The app no longer imports or calls `createAccount()`.
- Wallet access uses the injected EIP-1193 provider and `eth_requestAccounts`.
- Event signatures use `personal_sign`.
- `submit_case` and `adjudicate` estimate fees, request the connected wallet signature, wait for finalization, and verify the execution result.
- Only the case owner may adjudicate.
- The legacy V1 address is not a fallback. Onchain controls remain disabled until a V2 address is explicitly configured.

## 6. Verification commands and current result

```bash
npm test
npm run lint
npm run build
.venv\Scripts\pytest tests/direct -v
.venv\Scripts\genvm-lint contracts/agent_sla_judge.py
npm audit --omit=dev
```

Current verified result:

- Web security tests: 11 passed.
- ESLint and the production web build: passed.
- Direct GenVM tests: 14 passed, including a fixed signature vector created by the browser JavaScript implementation.
- GenVM linter: passed with no warnings.
- Production dependency audit: zero known vulnerabilities.

## 7. Deployment evidence

Finalized on Studio Dev (chain 61997) on October 22, 2026:

- V2 contract: [`0x025A22401c73c27F3DfE45e3CC3295CC2cbae4c0`](https://explorer-studio-dev.genlayer.com/address/0x025A22401c73c27F3DfE45e3CC3295CC2cbae4c0)
- Deployment transaction: [`0xde69da1619240181a3f299286c7144708d1d927bd25241d52932fea50ca5d89a`](https://explorer-studio-dev.genlayer.com/tx/0xde69da1619240181a3f299286c7144708d1d927bd25241d52932fea50ca5d89a)
- Explorer result: `FINALIZED`, GenVM `SUCCESS`, consensus `Accepted`.
- The frontend now uses this address as its reviewed default and still permits an explicit environment override.

## 8. Evidence still required before resubmission

Before resubmitting the contribution, append all of the following after they are visibly finalized:

- One finalized `submit_case` transaction.
- One finalized `adjudicate` transaction.
- `get_case` output showing exact packet hash and per-criterion results.
- Live app URL configured with the V2 address.

Do not describe a transaction as complete merely because the wallet popup opened or a transaction hash was drafted.
