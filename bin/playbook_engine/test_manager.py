import pytest
import tempfile
import os
from manager import PlaybookManager
from models import Playbook, PlaybookStep, ActionBinding, TriggerPattern

def make_playbook(id="test", name="Test", confidence="high", keywords=None, steps=None):
    return Playbook(
        id=id, name=name, version=1, confidence=confidence,
        trigger_patterns=[TriggerPattern(keywords=keywords or ["SSO"], source=["freshservice"])],
        created_from="session", executions=3,
        steps=steps or [],
    )

def test_save_and_load(tmp_path):
    mgr = PlaybookManager(str(tmp_path))
    pb = make_playbook()
    mgr.save(pb)
    loaded = mgr.get("test")
    assert loaded.id == "test"
    assert loaded.confidence == "high"

def test_list_playbooks(tmp_path):
    mgr = PlaybookManager(str(tmp_path))
    mgr.save(make_playbook(id="a", name="A"))
    mgr.save(make_playbook(id="b", name="B"))
    pbs = mgr.list_playbooks()
    assert len(pbs) == 2
    assert {p.id for p in pbs} == {"a", "b"}

def test_match_ticket(tmp_path):
    mgr = PlaybookManager(str(tmp_path))
    mgr.save(make_playbook(id="sso", keywords=["SSO", "SAML"]))
    mgr.save(make_playbook(id="cert", keywords=["certificate", "renewal"]))
    matches = mgr.match_ticket(ticket_type="Service Request", text="Set up SSO for Linear", source="freshservice")
    assert len(matches) == 1
    assert matches[0].id == "sso"

def test_save_draft(tmp_path):
    mgr = PlaybookManager(str(tmp_path))
    pb = make_playbook(id="draft-test", confidence="low")
    mgr.save_draft(pb)
    drafts = mgr.list_drafts()
    assert len(drafts) == 1
    assert drafts[0].id == "draft-test"

def test_promote_draft(tmp_path):
    mgr = PlaybookManager(str(tmp_path))
    pb = make_playbook(id="promote-test", confidence="low")
    mgr.save_draft(pb)
    mgr.promote_draft("promote-test")
    assert mgr.get("promote-test") is not None
    assert len(mgr.list_drafts()) == 0

def test_archive_version(tmp_path):
    mgr = PlaybookManager(str(tmp_path))
    pb = make_playbook(id="versioned", confidence="high")
    mgr.save(pb)
    pb.version = 2
    pb.update_history.append({"version": 2, "reason": "added step"})
    mgr.save(pb, archive_previous=True)
    loaded = mgr.get("versioned")
    assert loaded.version == 2
    archives = mgr.list_archive("versioned")
    assert len(archives) == 1

def test_invalid_playbook_id_rejected(tmp_path):
    mgr = PlaybookManager(str(tmp_path))
    import pytest
    with pytest.raises(ValueError):
        mgr.get("../../../etc/passwd")
    with pytest.raises(ValueError):
        mgr.get("UPPER_CASE")
    with pytest.raises(ValueError):
        mgr.get("")
    with pytest.raises(ValueError):
        mgr.delete_draft("../../bad")

def test_delete_nonexistent_draft(tmp_path):
    mgr = PlaybookManager(str(tmp_path))
    assert mgr.delete_draft("nonexistent") is False

def test_promote_nonexistent_draft(tmp_path):
    mgr = PlaybookManager(str(tmp_path))
    assert mgr.promote_draft("nonexistent") is None
