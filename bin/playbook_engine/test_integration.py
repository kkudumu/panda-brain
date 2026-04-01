"""End-to-end test: trace capture -> extraction -> storage -> matching -> execution dispatch."""

import pytest
import yaml
import tempfile
import json
from tracer import WorkflowTracer, TraceEvent
from registry import ToolRegistry
from extractor import PlaybookExtractor
from manager import PlaybookManager
from models import Playbook

@pytest.fixture
def env(tmp_path):
    """Set up a complete playbook environment."""
    playbooks_dir = tmp_path / "playbooks"
    playbooks_dir.mkdir()
    (playbooks_dir / "drafts").mkdir()
    (playbooks_dir / "archive").mkdir()

    reg_dir = playbooks_dir / "tool-registry"
    reg_dir.mkdir()
    (reg_dir / "_registry.yml").write_text(yaml.dump({
        "tools": {
            "jira": {"type": "mcp", "prefix": "mcp__mcp-atlassian__jira_", "capabilities": ["create_issue", "transition_issue"], "auth": "persistent", "domains": ["ticket_management"]},
            "slack": {"type": "mcp", "prefix": "mcp__slack__", "capabilities": ["post_message"], "auth": "persistent", "domains": ["communication"]},
            "freshservice": {"type": "mcp", "prefix": "mcp__freshservice-mcp__", "capabilities": ["update_ticket"], "auth": "persistent", "domains": ["service_desk"]},
            "playwright_cli": {"type": "browser", "tool": "playwright_cli", "capabilities": ["navigate", "click", "fill", "snapshot", "eval"], "auth": "per_domain", "domains": ["standard_web_ui"]},
        }
    }))
    (reg_dir / "jira.defaults.yml").write_text(yaml.dump({
        "create_issue": {"assignee": "kioja@test.com", "board_id": 70},
    }))

    traces_dir = tmp_path / "traces"
    return {
        "playbooks_dir": str(playbooks_dir),
        "traces_dir": str(traces_dir),
        "registry_dir": str(reg_dir),
    }

def test_full_flow(env):
    """Simulate: work SSO ticket -> extract playbook -> match new ticket -> dispatch."""

    # 1. Capture a workflow trace
    tracer = WorkflowTracer(traces_dir=env["traces_dir"])
    tracer.start_trace("ITWORK2-100")

    tracer.add_event(TraceEvent(type="user_instruction", content="Do SSO onboarding for Linear"))
    tracer.add_event(TraceEvent(type="tool_call", tool="mcp__mcp-atlassian__jira_create_issue",
        params={"project": "ITWORK2", "summary": "[SSO] Linear", "assignee": "kioja@test.com", "board_id": 70}))
    tracer.add_event(TraceEvent(type="user_manual_action", content="Configured SAML in Okta",
        inferred_step="Configure SAML in IdP", action_binding="playwright", auth_note="Okta admin"))
    tracer.add_event(TraceEvent(type="tool_call", tool="mcp__slack__post_message",
        params={"channel": "C123", "text": "SSO ready for Linear"}))
    tracer.add_event(TraceEvent(type="tool_call", tool="mcp__freshservice-mcp__update_ticket",
        params={"ticket_id": 456, "status": 5}))
    tracer.flush("ITWORK2-100")

    # 2. Extract a playbook
    registry = ToolRegistry(env["registry_dir"])
    extractor = PlaybookExtractor(registry=registry)
    trace = tracer.get_trace("ITWORK2-100")
    pb = extractor.extract_from_trace(trace, name="SSO Onboarding")

    assert pb.id == "sso-onboarding"
    assert pb.confidence == "low"
    assert len(pb.steps) == 4
    assert pb.steps[1].human_required is True  # manual SAML config

    # 3. Save as draft, review, promote
    manager = PlaybookManager(env["playbooks_dir"])
    manager.save_draft(pb)
    assert len(manager.list_drafts()) == 1

    manager.promote_draft("sso-onboarding")
    assert len(manager.list_drafts()) == 0
    assert len(manager.list_playbooks()) == 1

    # 4. Match against a new ticket
    matches = manager.match_ticket(
        ticket_type="Service Request",
        text="Please set up SSO for Notion",
        source="freshservice",
    )
    assert len(matches) == 1
    assert matches[0].id == "sso-onboarding"

    # 5. Record execution and check confidence progression
    promoted = manager.get("sso-onboarding")
    promoted.record_execution(success=True)
    assert promoted.confidence == "medium"
    assert promoted.executions == 1
    manager.save(promoted)

    # Verify persistence
    reloaded = manager.get("sso-onboarding")
    assert reloaded.confidence == "medium"
    assert reloaded.executions == 1

def test_no_match_returns_empty(env):
    manager = PlaybookManager(env["playbooks_dir"])
    matches = manager.match_ticket(text="New laptop request", source="freshservice")
    assert matches == []

def test_dictated_playbook_flow(env):
    """Path 2: User describes steps, engine creates playbook."""
    registry = ToolRegistry(env["registry_dir"])
    extractor = PlaybookExtractor(registry=registry)

    pb = extractor.extract_from_description(
        name="Employee Offboarding",
        steps_text=[
            "Disable user account in Okta",
            "Remove from all Slack channels",
            "Archive Jira tickets",
            "Send confirmation email to manager",
        ],
    )

    assert pb.id == "employee-offboarding"
    assert pb.confidence == "medium"  # dictated starts at medium
    assert len(pb.steps) == 4
    assert pb.created_from == "dictated"

    manager = PlaybookManager(env["playbooks_dir"])
    manager.save(pb)
    loaded = manager.get("employee-offboarding")
    assert loaded is not None
