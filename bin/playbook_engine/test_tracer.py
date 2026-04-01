import pytest
import json
import os
from tracer import WorkflowTracer, TraceEvent

def test_add_tool_call_event(tmp_path):
    tracer = WorkflowTracer(traces_dir=str(tmp_path))
    tracer.start_trace("ITWORK2-1234")
    tracer.add_event(TraceEvent(
        type="tool_call",
        tool="mcp__mcp-atlassian__jira_create_issue",
        params={"project": "ITWORK2", "summary": "Test"},
    ))
    trace = tracer.get_trace("ITWORK2-1234")
    assert len(trace["events"]) == 1
    assert trace["events"][0]["type"] == "tool_call"

def test_add_user_instruction_event(tmp_path):
    tracer = WorkflowTracer(traces_dir=str(tmp_path))
    tracer.start_trace("ITWORK2-1234")
    tracer.add_event(TraceEvent(
        type="user_instruction",
        content="Always set due date to 30 days out",
        applies_to=["jira.create_issue"],
        persist=True,
    ))
    trace = tracer.get_trace("ITWORK2-1234")
    assert trace["events"][0]["type"] == "user_instruction"
    assert trace["events"][0]["persist"] is True

def test_add_user_correction_event(tmp_path):
    tracer = WorkflowTracer(traces_dir=str(tmp_path))
    tracer.start_trace("ITWORK2-1234")
    tracer.add_event(TraceEvent(
        type="user_correction",
        content="No, assign to next sprint",
        corrects="tool_defaults.jira.create_issue.sprint",
        new_value="next",
    ))
    trace = tracer.get_trace("ITWORK2-1234")
    assert trace["events"][0]["corrects"] == "tool_defaults.jira.create_issue.sprint"

def test_add_manual_action_event(tmp_path):
    tracer = WorkflowTracer(traces_dir=str(tmp_path))
    tracer.start_trace("ITWORK2-1234")
    tracer.add_event(TraceEvent(
        type="user_manual_action",
        content="I configured SAML in Okta",
        inferred_step="Configure SAML in IdP",
        action_binding="playwright",
        auth_note="needs Okta admin",
    ))
    trace = tracer.get_trace("ITWORK2-1234")
    assert trace["events"][0]["action_binding"] == "playwright"

def test_trace_persists_to_disk(tmp_path):
    tracer = WorkflowTracer(traces_dir=str(tmp_path))
    tracer.start_trace("ITWORK2-5678")
    tracer.add_event(TraceEvent(type="tool_call", tool="test_tool"))
    tracer.flush("ITWORK2-5678")
    path = tmp_path / "active" / "ITWORK2-5678.json"
    assert path.exists()
    with open(path) as f:
        data = json.load(f)
    assert len(data["events"]) == 1

def test_similarity_score(tmp_path):
    tracer = WorkflowTracer(traces_dir=str(tmp_path))
    tracer.start_trace("t1")
    tracer.add_event(TraceEvent(type="tool_call", tool="jira_create"))
    tracer.add_event(TraceEvent(type="tool_call", tool="slack_post"))
    tracer.add_event(TraceEvent(type="tool_call", tool="freshservice_update"))

    tracer.start_trace("t2")
    tracer.add_event(TraceEvent(type="tool_call", tool="jira_create"))
    tracer.add_event(TraceEvent(type="tool_call", tool="slack_post"))
    tracer.add_event(TraceEvent(type="tool_call", tool="freshservice_update"))

    score = tracer.similarity("t1", "t2")
    assert score >= 0.9  # nearly identical tool sequences

def test_from_dict_ignores_unknown_keys(tmp_path):
    """TraceEvent.from_dict should ignore unknown keys gracefully."""
    event = TraceEvent.from_dict({"type": "tool_call", "tool": "test", "unknown_field": "ignored"})
    assert event.type == "tool_call"
    assert event.tool == "test"
