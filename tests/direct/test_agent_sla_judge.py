"""Direct-mode security and consensus tests for the AgentSLA contract."""

import base64
import hashlib
import json
import sys

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct


@pytest.fixture(autouse=True)
def reset_genlayer_contract_registry():
    """Isolate contract imports across direct-mode tests.

    The GenLayer Python runtime intentionally permits one Contract subclass per
    loaded module. The direct runner reloads the same contract file for every
    test but does not clear that runtime registry, so a clean multi-test CI run
    would otherwise fail after the first deployment.
    """

    contract_module = sys.modules.get("genlayer.contract")
    if contract_module is not None:
        setattr(contract_module, "__known_contract__", None)

    yield

    contract_module = sys.modules.get("genlayer.contract")
    if contract_module is not None:
        setattr(contract_module, "__known_contract__", None)


TERMS = (
    "Deliver report.json before the deadline with no failed health checks. "
    "PASS requires every mandatory criterion to pass independently."
)
JS_VECTOR_ADDRESS = "0x3Ae4a709325d605b3Ab120fa2a2Fc8230a1e351B"
JS_VECTOR_EVENTS = [
    {
        "id": "health-js",
        "type": "healthcheck",
        "status": 200,
        "latencyMs": 321,
        "signer": {
            "address": JS_VECTOR_ADDRESS,
            "scheme": "eip191",
            "signature": "0x6fcd7d58e33dc23f85fe73cd8dd9b0b5bb7bc38fb0252181c5561a2f9bed172f1a571f6e3b8cfd5cab82fea02bb76938f6e714452a9e8657dc57f1e5271c3bef1b",
        },
    },
    {
        "id": "delivery-js",
        "type": "delivery",
        "receipt": "accepted",
        "signer": {
            "address": JS_VECTOR_ADDRESS,
            "scheme": "eip191",
            "signature": "0xfa7b23e7b381529d222708eea7bd609a2614b73d4435104d7533f78639ebe2456e6d3a98fe8fa862bd85a751e62132d88965c0d15948aab2da1bbf8cc55078161b",
        },
    },
    {
        "id": "checkpoint-js",
        "type": "checkpoint",
        "value": "complete",
        "signer": {
            "address": JS_VECTOR_ADDRESS,
            "scheme": "eip191",
            "signature": "0x48262119ae5ebc822629a8f36a8d1c118482142068d4a6b0f21aaf3fdb69cf965218a6994f23c0f4efaa76d3a9de26100f81049c81aec77a95dc09ff907610d31c",
        },
    },
]
def account_sender(account) -> bytes:
    return bytes.fromhex(account.address[2:])


@pytest.fixture
def wallet_account(direct_vm):
    account = Account.create()
    direct_vm.sender = account_sender(account)
    return account


def sign_event(account, service: str, window: dict, event: dict) -> None:
    unsigned_event = json.loads(json.dumps(event))
    unsigned_event["signer"].pop("signature", None)
    signing_message = "AgentSLA signed event v1\n" + json.dumps(
        {"event": unsigned_event, "service": service, "window": window},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    signed = account.sign_message(encode_defunct(text=signing_message))
    event["signer"]["signature"] = "0x" + bytes(signed.signature).hex()


def build_packet(account, *, artifact_content: bytes = b'{"answer":42}\n') -> str:
    owner = account.address
    service = "atlas-agent"
    window = {
        "start": "2026-10-21T08:00:00Z",
        "end": "2026-10-21T08:30:00Z",
    }
    artifact_hash = hashlib.sha256(artifact_content).hexdigest()
    events = [
        {
            "id": "health-1",
            "type": "healthcheck",
            "status": 200,
            "latencyMs": 500,
            "signer": {"address": owner, "scheme": "eip191"},
        },
        {
            "id": "artifact-report",
            "type": "artifact",
            "name": "report.json",
            "sha256": artifact_hash,
            "contentBase64": base64.b64encode(artifact_content).decode("ascii"),
            "signer": {"address": owner, "scheme": "eip191"},
        },
        {
            "id": "delivery-1",
            "type": "delivery",
            "receipt": "accepted",
            "signer": {"address": owner, "scheme": "eip191"},
        },
    ]
    for event in events:
        sign_event(account, service, window, event)
    packet = {
        "schema": "agentsla/evidence-pack@2",
        "createdAt": "2026-10-21T00:00:00.000Z",
        "terms": TERMS,
        "publicEvidence": {"url": "", "sha256": ""},
        "evidence": {
            "service": service,
            "window": window,
            "authorizedSigners": [{"address": owner, "role": "agent-operator"}],
            "events": events,
            "criteria": [
                {
                    "id": "availability",
                    "description": "Every health check must return a successful status.",
                    "required": True,
                    "evidenceEventIds": ["health-1"],
                },
                {
                    "id": "deliverable",
                    "description": "The required report must match its declared SHA-256.",
                    "required": True,
                    "evidenceEventIds": ["artifact-report", "delivery-1"],
                },
            ],
        },
        "verification": {
            "allVerified": True,
            "eventSignatures": [
                {
                    "eventId": event["id"],
                    "signerAddress": owner,
                    "recoveredAddress": owner,
                    "authorized": True,
                    "valid": True,
                }
                for event in events
            ],
            "artifacts": [
                {
                    "eventId": "artifact-report",
                    "expectedHash": artifact_hash,
                    "actualHash": artifact_hash,
                    "valid": True,
                }
            ],
            "publicEvidence": {"url": "", "sha256": "", "verified": False},
        },
        "preflight": {"label": "VERIFIED FOR REVIEW", "score": 100, "checks": []},
    }
    return json.dumps(packet, sort_keys=True, separators=(",", ":"))


def submit(contract, account, case_id: str = "case-001", evidence: str | None = None):
    evidence = evidence or build_packet(account)
    evidence_hash = hashlib.sha256(evidence.encode("utf-8")).hexdigest()
    contract.submit_case(case_id, TERMS, evidence, evidence_hash, "", "")
    return evidence, evidence_hash


def build_javascript_vector_packet() -> str:
    packet = {
        "schema": "agentsla/evidence-pack@2",
        "createdAt": "2026-10-22T00:00:00.000Z",
        "terms": TERMS,
        "publicEvidence": {"url": "", "sha256": ""},
        "evidence": {
            "service": "interop-agent",
            "window": {
                "start": "2026-10-22T08:00:00Z",
                "end": "2026-10-22T08:30:00Z",
            },
            "authorizedSigners": [{"address": JS_VECTOR_ADDRESS, "role": "agent-operator"}],
            "events": JS_VECTOR_EVENTS,
            "criteria": [
                {
                    "id": "interop",
                    "description": "The JavaScript-signed events must be cryptographically valid.",
                    "required": True,
                    "evidenceEventIds": ["health-js", "delivery-js", "checkpoint-js"],
                }
            ],
        },
        "verification": {
            "allVerified": True,
            "eventSignatures": [
                {
                    "eventId": event["id"],
                    "signerAddress": JS_VECTOR_ADDRESS,
                    "recoveredAddress": JS_VECTOR_ADDRESS,
                    "authorized": True,
                    "valid": True,
                }
                for event in JS_VECTOR_EVENTS
            ],
            "artifacts": [],
            "publicEvidence": {"url": "", "sha256": "", "verified": False},
        },
        "preflight": {"label": "VERIFIED FOR REVIEW", "score": 100, "checks": []},
    }
    return json.dumps(packet, sort_keys=True, separators=(",", ":"))


def mock_verdict(direct_vm, availability="PASS", deliverable="PASS"):
    direct_vm.mock_llm(
        r".*You are adjudicating an autonomous-agent SLA.*",
        # gltest pre-parses one JSON layer before the v0.6 runtime decodes the
        # response_format="json" payload, so keep the inner verdict as text.
        json.dumps(json.dumps(
            {
                "criteria": [
                    {
                        "id": "availability",
                        "outcome": availability,
                        "score": 96 if availability == "PASS" else 40,
                        "reason": "Health-check evidence supports this result.",
                    },
                    {
                        "id": "deliverable",
                        "outcome": deliverable,
                        "score": 94 if deliverable == "PASS" else 35,
                        "reason": "Artifact and delivery evidence support this result.",
                    },
                ]
            }
        )),
    )


def test_submit_anchors_exact_evidence_hash(direct_deploy, wallet_account):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    evidence, evidence_hash = submit(contract, wallet_account)

    result = contract.get_case("case-001")
    assert result["status"] == "PENDING"
    assert result["evidence"] == evidence
    assert result["evidence_hash"] == evidence_hash
    assert result["owner"].lower() == wallet_account.address.lower()


def test_contract_recovers_signatures_created_by_browser_javascript(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    direct_vm.sender = bytes.fromhex(JS_VECTOR_ADDRESS[2:])
    evidence = build_javascript_vector_packet()
    evidence_hash = hashlib.sha256(evidence.encode("utf-8")).hexdigest()

    contract.submit_case("case-js-vector", TERMS, evidence, evidence_hash, "", "")
    assert contract.get_case("case-js-vector")["status"] == "PENDING"


def test_all_mandatory_criteria_must_pass(direct_vm, direct_deploy, wallet_account):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    submit(contract, wallet_account, "case-pass")
    mock_verdict(direct_vm)

    contract.adjudicate("case-pass")
    result = contract.get_case("case-pass")
    criteria_results = json.loads(result["criteria_results"])
    assert result["status"] == "PASS"
    assert result["score"] == "95"
    assert [item["id"] for item in criteria_results] == ["availability", "deliverable"]


def test_one_ambiguous_mandatory_criterion_forces_review(direct_vm, direct_deploy, wallet_account):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    submit(contract, wallet_account, "case-review")
    mock_verdict(direct_vm, deliverable="NEEDS_REVIEW")

    contract.adjudicate("case-review")
    assert contract.get_case("case-review")["status"] == "NEEDS_REVIEW"


def test_one_failed_mandatory_criterion_forces_failure(direct_vm, direct_deploy, wallet_account):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    submit(contract, wallet_account, "case-fail")
    mock_verdict(direct_vm, availability="FAIL")

    contract.adjudicate("case-fail")
    assert contract.get_case("case-fail")["status"] == "FAIL"


def test_tampered_packet_hash_reverts(direct_vm, direct_deploy, wallet_account):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    evidence = build_packet(wallet_account)

    with direct_vm.expect_revert("Evidence hash mismatch"):
        contract.submit_case("case-hash", TERMS, evidence, "a" * 64, "", "")


def test_tampered_artifact_bytes_revert(direct_vm, direct_deploy, wallet_account):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    packet = json.loads(build_packet(wallet_account))
    packet["evidence"]["events"][1]["contentBase64"] = base64.b64encode(b"tampered").decode("ascii")
    sign_event(
        wallet_account,
        packet["evidence"]["service"],
        packet["evidence"]["window"],
        packet["evidence"]["events"][1],
    )
    evidence = json.dumps(packet, sort_keys=True, separators=(",", ":"))
    evidence_hash = hashlib.sha256(evidence.encode("utf-8")).hexdigest()

    with direct_vm.expect_revert("Artifact SHA-256 mismatch"):
        contract.submit_case("case-artifact", TERMS, evidence, evidence_hash, "", "")


def test_tampered_signed_event_reverts(direct_vm, direct_deploy, wallet_account):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    packet = json.loads(build_packet(wallet_account))
    packet["evidence"]["events"][0]["status"] = 503
    evidence = json.dumps(packet, sort_keys=True, separators=(",", ":"))
    evidence_hash = hashlib.sha256(evidence.encode("utf-8")).hexdigest()

    with direct_vm.expect_revert("Event EIP-191 signature does not match the case owner"):
        contract.submit_case("case-tampered-event", TERMS, evidence, evidence_hash, "", "")


def test_missing_required_evidence_reference_reverts(direct_vm, direct_deploy, wallet_account):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    packet = json.loads(build_packet(wallet_account))
    packet["evidence"]["criteria"][0]["evidenceEventIds"] = ["missing"]
    evidence = json.dumps(packet, sort_keys=True, separators=(",", ":"))
    evidence_hash = hashlib.sha256(evidence.encode("utf-8")).hexdigest()

    with direct_vm.expect_revert("Criterion references an unknown event"):
        contract.submit_case("case-reference", TERMS, evidence, evidence_hash, "", "")


def test_event_signer_must_match_transaction_sender(direct_vm, direct_deploy, wallet_account):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    other_account = Account.create()
    evidence = build_packet(other_account)
    evidence_hash = hashlib.sha256(evidence.encode("utf-8")).hexdigest()

    with direct_vm.expect_revert("Transaction sender is not an authorized signer"):
        contract.submit_case("case-owner", TERMS, evidence, evidence_hash, "", "")


def test_recovered_signer_result_must_match_transaction_sender(
    direct_vm,
    direct_deploy,
    wallet_account,
):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    packet = json.loads(build_packet(wallet_account))
    packet["verification"]["eventSignatures"][0]["recoveredAddress"] = Account.create().address
    evidence = json.dumps(packet, sort_keys=True, separators=(",", ":"))
    evidence_hash = hashlib.sha256(evidence.encode("utf-8")).hexdigest()

    with direct_vm.expect_revert("Recovered signer does not match case owner"):
        contract.submit_case("case-recovered", TERMS, evidence, evidence_hash, "", "")


def test_only_case_owner_can_adjudicate(direct_vm, direct_deploy, wallet_account):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    submit(contract, wallet_account, "case-owner-only")
    direct_vm.sender = account_sender(Account.create())

    with direct_vm.expect_revert("Only the case owner can adjudicate"):
        contract.adjudicate("case-owner-only")


def test_public_evidence_url_and_hash_are_an_atomic_pair(direct_vm, direct_deploy, wallet_account):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    evidence = build_packet(wallet_account)
    evidence_hash = hashlib.sha256(evidence.encode("utf-8")).hexdigest()

    with direct_vm.expect_revert("Public evidence URL and hash must be supplied together"):
        contract.submit_case(
            "case-public",
            TERMS,
            evidence,
            evidence_hash,
            "https://example.com/proof.json",
            "",
        )


def test_duplicate_case_reverts(direct_vm, direct_deploy, wallet_account):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    submit(contract, wallet_account, "case-duplicate")

    with direct_vm.expect_revert("Case already exists"):
        submit(contract, wallet_account, "case-duplicate")
