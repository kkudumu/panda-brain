import pytest
import tempfile
import yaml
from tracer import WorkflowTracer, TraceEvent
from registry import ToolRegistry
from extractor import PlaybookExtractor
from models import Playbook

def make_registry(tmp_path):
    reg_dir = tmp_path / "tool-registry"
    reg_dir.mkdir()
    (reg_dir / "_registry.yml").write_text(yaml.dump({
        "tools": {
            "jira": {"type": "mcp", "prefix": "mcp__mcp-atlassian__jira_", "capabilities": ["create_issue"], "auth": "persistent", "domains": ["ticket_management"]},
            "slack": {"type": "mcp", "prefix": "mcp__slack__", "capabilities": ["post_message"], "auth": "persistent", "domains": ["communication"]},
            "freshservice": {"type": "mcp", "prefix": "mcp__freshservice-mcp__", "capabilities": ["update_ticket"], "auth": "persistent", "domains": ["service_desk"]},
        }
    }))
    (reg_dir / "jira.defaults.yml").write_text(yaml.dump({"create_issue": {"assignee": "test@test.com"}}))
    return ToolRegistry(str(reg_dir))

def test_extract_playbook_from_trace(tmp_path):
    registry = make_registry(tmp_path)
    tracer = WorkflowTracer(traces_dir=str(tmp_path / "traces"))

    tracer.start_trace("ITWORK2-100")
    tracer.add_event(TraceEvent(type="user_instruction", content="Do SSO onboarding for Linear"))
    tracer.add_event(TraceEvent(type="tool_call", tool="mcp__mcp-atlassian__jira_create_issue", params={"project": "ITWORK2", "summary": "[SSO] Linear"}))
    tracer.add_event(TraceEvent(type="user_manual_action", content="Configured SAML in Okta", inferred_step="Configure SAML", action_binding="playwright", auth_note="needs Okta admin"))
    tracer.add_event(TraceEvent(type="tool_call", tool="mcp__slack__post_message", params={"channel": "C123", "text": "SSO configured"}))
    tracer.add_event(TraceEvent(type="tool_call", tool="mcp__freshservice-mcp__update_ticket", params={"ticket_id": 456, "status": "resolved"}))

    extractor = PlaybookExtractor(registry=registry)
    pb = extractor.extract_from_trace(tracer.get_trace("ITWORK2-100"), name="SSO Onboarding")

    assert pb.id == "sso-onboarding"
    assert pb.confidence == "low"
    assert pb.created_from == "session"
    assert len(pb.steps) == 4  # jira + manual + slack + freshservice
    assert pb.steps[0].action.tool == "mcp__mcp-atlassian__jira_create_issue"
    assert pb.steps[1].human_required is True  # manual action
    assert pb.steps[1].action.tool == "playwright"

def test_extract_identifies_dynamic_params(tmp_path):
    registry = make_registry(tmp_path)
    tracer = WorkflowTracer(traces_dir=str(tmp_path / "traces"))

    tracer.start_trace("t1")
    tracer.add_event(TraceEvent(type="tool_call", tool="mcp__mcp-atlassian__jira_create_issue", params={"project": "ITWORK2", "summary": "[SSO] Linear", "assignee": "test@test.com"}))

    extractor = PlaybookExtractor(registry=registry)
    pb = extractor.extract_from_trace(tracer.get_trace("t1"), name="Test")

    # assignee matches default, so should NOT be in playbook params (it comes from defaults)
    # summary is ticket-specific, so should be a param with a source
    step = pb.steps[0]
    assert "assignee" not in step.action.params  # comes from defaults
    assert "summary" in step.action.params or "summary" in step.action.param_sources

def test_extract_captures_user_rules(tmp_path):
    registry = make_registry(tmp_path)
    tracer = WorkflowTracer(traces_dir=str(tmp_path / "traces"))

    tracer.start_trace("t1")
    tracer.add_event(TraceEvent(type="user_rule", content="Always add SSO label", applies_to=["jira.create_issue"], persist=True))
    tracer.add_event(TraceEvent(type="tool_call", tool="mcp__mcp-atlassian__jira_create_issue", params={"project": "ITWORK2"}))

    extractor = PlaybookExtractor(registry=registry)
    pb = extractor.extract_from_trace(tracer.get_trace("t1"), name="Test")
    assert pb is not None
    # The extractor should note persistent rules for default updates
    assert len(extractor.pending_default_updates) > 0
