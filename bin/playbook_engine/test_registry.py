import pytest
import yaml
import tempfile
import os
from registry import ToolRegistry

def test_load_registry(tmp_path):
    reg_dir = tmp_path / "tool-registry"
    reg_dir.mkdir()

    (reg_dir / "_registry.yml").write_text(yaml.dump({
        "tools": {
            "jira": {
                "type": "mcp",
                "prefix": "mcp__mcp-atlassian__jira_",
                "capabilities": ["create_issue"],
                "auth": "persistent",
                "domains": ["ticket_management"],
            }
        }
    }))

    (reg_dir / "jira.defaults.yml").write_text(yaml.dump({
        "create_issue": {"assignee": "test@test.com", "board_id": 70},
        "field_mappings": {"sprint_field": "customfield_10020"},
    }))

    reg = ToolRegistry(str(reg_dir))
    assert "jira" in reg.tools
    assert reg.tools["jira"]["type"] == "mcp"
    assert reg.get_defaults("jira", "create_issue")["assignee"] == "test@test.com"

def test_get_defaults_missing_tool(tmp_path):
    reg_dir = tmp_path / "tool-registry"
    reg_dir.mkdir()
    (reg_dir / "_registry.yml").write_text(yaml.dump({"tools": {}}))
    reg = ToolRegistry(str(reg_dir))
    assert reg.get_defaults("nonexistent", "action") == {}

def test_merge_params(tmp_path):
    reg_dir = tmp_path / "tool-registry"
    reg_dir.mkdir()
    (reg_dir / "_registry.yml").write_text(yaml.dump({
        "tools": {"jira": {"type": "mcp", "prefix": "p_", "capabilities": [], "auth": "persistent", "domains": []}}
    }))
    (reg_dir / "jira.defaults.yml").write_text(yaml.dump({
        "create_issue": {"assignee": "default@test.com", "board_id": 70},
    }))
    reg = ToolRegistry(str(reg_dir))
    merged = reg.merge_params("jira", "create_issue", {"summary": "Test", "assignee": "override@test.com"})
    assert merged["assignee"] == "override@test.com"  # playbook overrides default
    assert merged["board_id"] == 70  # default fills in
    assert merged["summary"] == "Test"  # playbook-specific preserved

def test_resolve_tool_from_mcp_name(tmp_path):
    reg_dir = tmp_path / "tool-registry"
    reg_dir.mkdir()
    (reg_dir / "_registry.yml").write_text(yaml.dump({
        "tools": {
            "jira": {"type": "mcp", "prefix": "mcp__mcp-atlassian__jira_", "capabilities": [], "auth": "persistent", "domains": []},
            "slack": {"type": "mcp", "prefix": "mcp__slack__", "capabilities": [], "auth": "persistent", "domains": []},
        }
    }))
    reg = ToolRegistry(str(reg_dir))
    assert reg.resolve_tool_name("mcp__mcp-atlassian__jira_create_issue") == ("jira", "create_issue")
    assert reg.resolve_tool_name("mcp__slack__post_message") == ("slack", "post_message")
    assert reg.resolve_tool_name("unknown_tool") == (None, None)
