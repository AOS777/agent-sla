"""Direct-mode tests for the AgentSLA intelligent contract."""

import json


TERMS = "Deliver report.json before the deadline with no failed health checks."
EVIDENCE = json.dumps(
    {
        "service": "atlas-agent",
        "events": [
            {"type": "healthcheck", "status": 200},
            {"type": "artifact", "name": "report.json"},
        ],
        "signedBy": "agent:atlas-07",
    }
)


def test_submit_and_read_pending_case(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    direct_vm.sender = direct_alice

    contract.submit_case("case-001", TERMS, EVIDENCE, "")
    result = contract.get_case("case-001")

    assert result["status"] == "PENDING"
    assert result["score"] == "0"
    assert result["evidence"] == EVIDENCE


def test_consensus_pass_verdict(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    direct_vm.sender = direct_alice
    contract.submit_case("case-002", TERMS, EVIDENCE, "")
    direct_vm.mock_llm(
        r".*You are adjudicating whether.*",
        json.dumps(
            {
                "outcome": "PASS",
                "score": 96,
                "reason": "The required artifact and healthy execution are evidenced.",
            }
        ),
    )

    contract.adjudicate("case-002")
    result = contract.get_case("case-002")

    assert result["status"] == "PASS"
    assert result["score"] == "96"


def test_duplicate_case_reverts(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/agent_sla_judge.py")
    direct_vm.sender = direct_alice
    contract.submit_case("case-003", TERMS, EVIDENCE, "")

    with direct_vm.expect_revert("Case already exists"):
        contract.submit_case("case-003", TERMS, EVIDENCE, "")
