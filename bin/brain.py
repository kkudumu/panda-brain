"""
eng-buddy Learning Engine.
Builds context prompts from persistent memory and parses Claude responses
for new patterns, stakeholder updates, and automation opportunities.
"""
import argparse
import json
import os
import re
import sqlite3
import sys
import tasks_db
from datetime import date, datetime
from pathlib import Path

# Feature flag: set BRAIN_ENABLE_POLLER=1 to re-enable poller intake code paths.
# When unset or "0" (default), poller code is skipped.
# This flag exists as a rollback escape hatch; poller intake is disabled by default.
BRAIN_ENABLE_POLLER = os.environ.get("BRAIN_ENABLE_POLLER", "0") == "1"

ENG_BUDDY_DIR = Path.home() / ".claude" / "eng-buddy"
MEMORY_DIR = ENG_BUDDY_DIR / "memory"
MEMORY_DIR.mkdir(exist_ok=True)

DB_PATH = ENG_BUDDY_DIR / "inbox.db"
DAILY_DIR = ENG_BUDDY_DIR / "daily"
PATTERNS_DIR = ENG_BUDDY_DIR / "patterns"
STAKEHOLDERS_DIR = ENG_BUDDY_DIR / "stakeholders"
KNOWLEDGE_DIR = ENG_BUDDY_DIR / "knowledge"

UNMAPPED_LEARNING_PATH = PATTERNS_DIR / "uncategorized-learning.md"
UNMAPPED_LEARNING_HEADING = "## AI Captured Uncategorized Learning"

WRITE_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit"}
TASK_TOOLS = {"Bash", "Task"}
ACTION_MCP_PROVIDERS = {
    "mcp-atlassian",
    "freshservice-mcp",
    "gmail",
    "google-calendar",
    "slack",
    "lusha",
    "git",
}
READ_ONLY_MCP_PROVIDERS = {
    "context7",
    "apple-doc-mcp",
    "glean_default",
    "playwright",
    "sequential-thinking",
}


def _load(name, default=None):
    p = MEMORY_DIR / name
    if p.exists():
        try:
            return json.loads(p.read_text())
        except json.JSONDecodeError:
            pass
    return default if default is not None else {}


def _save(name, data):
    (MEMORY_DIR / name).write_text(json.dumps(data, indent=2))


def load_context():
    return _load("context.json", {})


def load_stakeholders():
    return _load("stakeholders.json", {})


def load_patterns():
    return _load("patterns.json", {"patterns": [], "automation_opportunities": []})


def load_traces():
    return _load("traces.json", {"traces": []})


def _normalize_category(name: str) -> str:
    if not name:
        return ""
    normalized = re.sub(r"[^a-z0-9_-]+", "-", str(name).strip().lower())
    normalized = re.sub(r"-+", "-", normalized).strip("-")
    return normalized


def _default_learning_routes():
    today_file = DAILY_DIR / f"{date.today().isoformat()}.md"
    return {
        "playbook": {
            "path": KNOWLEDGE_DIR / "runbooks.md",
            "heading": "## AI Captured Playbooks",
            "description": "Reusable work playbooks and runbook snippets",
            "source": "system",
        },
        "stakeholder": {
            "path": STAKEHOLDERS_DIR / "communication-log.md",
            "heading": "## AI Captured Stakeholder Notes",
            "description": "Stakeholder communication notes",
            "source": "system",
        },
        "personal": {
            "path": today_file,
            "heading": "## Personal Notes",
            "description": "Personal productivity notes for today",
            "source": "system",
        },
        "troubleshooting": {
            "path": PATTERNS_DIR / "recurring-issues.md",
            "heading": "## AI Captured Troubleshooting Patterns",
            "description": "Recurring issues and fixes",
            "source": "system",
        },
        "success-pattern": {
            "path": PATTERNS_DIR / "success-patterns.md",
            "heading": "## AI Captured Success Patterns",
            "description": "Patterns behind successful outcomes",
            "source": "system",
        },
        "failure-pattern": {
            "path": PATTERNS_DIR / "failure-patterns.md",
            "heading": "## AI Captured Failure Patterns",
            "description": "Patterns behind failed outcomes",
            "source": "system",
        },
        "recurring-question": {
            "path": PATTERNS_DIR / "recurring-questions.md",
            "heading": "## AI Captured Questions",
            "description": "Frequently recurring questions",
            "source": "system",
        },
        "documentation-gap": {
            "path": PATTERNS_DIR / "documentation-gaps.md",
            "heading": "## AI Captured Documentation Gaps",
            "description": "Missing docs and runbook gaps",
            "source": "system",
        },
        "task-execution": {
            "path": PATTERNS_DIR / "task-execution.md",
            "heading": "## AI Captured Task Execution Learnings",
            "description": "Learned signals from finished task operations",
            "source": "system",
        },
        "writing-update": {
            "path": KNOWLEDGE_DIR / "writing-updates.md",
            "heading": "## AI Captured Writing Updates",
            "description": "Learned signals from file writes and edits",
            "source": "system",
        },
    }


def _load_custom_learning_categories():
    data = _load("learning-categories.json", {"categories": {}})
    if not isinstance(data, dict):
        return {"categories": {}}
    categories = data.get("categories")
    if not isinstance(categories, dict):
        return {"categories": {}}
    return {"categories": categories}


def _save_custom_learning_categories(data):
    _save("learning-categories.json", data)


def get_learning_routes():
    routes = _default_learning_routes()
    custom = _load_custom_learning_categories().get("categories", {})

    for raw_name, meta in custom.items():
        if not isinstance(meta, dict):
            continue
        bucket = _normalize_category(raw_name)
        if not bucket:
            continue

        path_raw = str(meta.get("path", "")).strip()
        if path_raw:
            path = Path(path_raw).expanduser()
            if not path.is_absolute():
                path = ENG_BUDDY_DIR / path
        else:
            path = KNOWLEDGE_DIR / f"{bucket}.md"

        heading = str(meta.get("heading", "")).strip() or f"## AI Captured {bucket.replace('-', ' ').title()}"
        description = str(meta.get("description", "")).strip() or "User-defined learning category"

        routes[bucket] = {
            "path": path,
            "heading": heading,
            "description": description,
            "source": "custom",
        }

    return routes


def list_learning_buckets():
    return sorted(get_learning_routes().keys())


def _ensure_learning_schema():
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS learning_categories (
                name TEXT PRIMARY KEY,
                description TEXT,
                source TEXT NOT NULL DEFAULT 'system',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS learning_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                hook_event TEXT,
                source TEXT,
                scope TEXT,
                tool_name TEXT,
                category TEXT,
                title TEXT,
                note TEXT,
                status TEXT NOT NULL DEFAULT 'captured',
                requires_category_expansion INTEGER NOT NULL DEFAULT 0,
                proposed_category TEXT,
                metadata TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"""
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_learning_events_session ON learning_events(session_id, created_at)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_learning_events_category ON learning_events(category, created_at)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_learning_events_pending ON learning_events(requires_category_expansion, created_at)"
        )

        for bucket, meta in get_learning_routes().items():
            conn.execute(
                """INSERT OR IGNORE INTO learning_categories (name, description, source)
                   VALUES (?, ?, ?)""",
                [bucket, meta.get("description", ""), meta.get("source", "system")],
            )
        conn.commit()
    finally:
        conn.close()


def _ensure_ops_schema():
    """Create ops tracking tables: capacity, stakeholders, incidents, patterns, follow-ups, burnout."""
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS capacity_logs (
                id INTEGER PRIMARY KEY,
                date TEXT,
                metric TEXT,
                value REAL,
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS stakeholder_contacts (
                id INTEGER PRIMARY KEY,
                name TEXT,
                role TEXT,
                preferences TEXT,
                last_contact TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS incidents (
                id INTEGER PRIMARY KEY,
                title TEXT,
                severity TEXT,
                status TEXT DEFAULT 'open',
                timeline TEXT,
                root_cause TEXT,
                resolution TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS pattern_observations (
                id INTEGER PRIMARY KEY,
                type TEXT,
                title TEXT,
                description TEXT,
                confidence REAL,
                evidence TEXT,
                frequency INTEGER DEFAULT 1,
                first_seen TEXT,
                last_seen TEXT,
                source_file TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS follow_ups (
                id INTEGER PRIMARY KEY,
                stakeholder TEXT,
                topic TEXT,
                due_date TEXT,
                status TEXT DEFAULT 'pending',
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS burnout_indicators (
                id INTEGER PRIMARY KEY,
                date TEXT,
                indicator TEXT,
                severity TEXT,
                details TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )"""
        )
        # FTS5 virtual table for pattern search
        conn.execute(
            """CREATE VIRTUAL TABLE IF NOT EXISTS pattern_observations_fts USING fts5(
                title, description, evidence,
                content='pattern_observations',
                content_rowid='id'
            )"""
        )
        conn.commit()
    finally:
        conn.close()


def _record_learning_event(
    *,
    session_id: str = "",
    hook_event: str = "",
    source: str = "",
    scope: str = "",
    tool_name: str = "",
    category: str = "",
    title: str = "",
    note: str = "",
    status: str = "captured",
    requires_category_expansion: bool = False,
    proposed_category: str = "",
    metadata=None,
):
    _ensure_learning_schema()
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            """INSERT INTO learning_events (
                    session_id, hook_event, source, scope, tool_name,
                    category, title, note, status,
                    requires_category_expansion, proposed_category, metadata
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                session_id or "",
                hook_event or "",
                source or "",
                scope or "",
                tool_name or "",
                category or "",
                title or "",
                note or "",
                status,
                1 if requires_category_expansion else 0,
                proposed_category or "",
                json.dumps(metadata or {}),
            ],
        )
        conn.commit()
    finally:
        conn.close()


def register_learning_category(name: str, description: str = "", path: str = "", heading: str = ""):
    bucket = _normalize_category(name)
    if not bucket:
        raise ValueError("category name is required")

    resolved_path = path.strip() if path else f"knowledge/{bucket}.md"
    resolved_heading = heading.strip() if heading else f"## AI Captured {bucket.replace('-', ' ').title()}"
    resolved_description = description.strip() if description else "User-approved custom learning category"

    custom = _load_custom_learning_categories()
    custom.setdefault("categories", {})[bucket] = {
        "path": resolved_path,
        "heading": resolved_heading,
        "description": resolved_description,
    }
    _save_custom_learning_categories(custom)

    _ensure_learning_schema()
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            """INSERT INTO learning_categories (name, description, source)
               VALUES (?, ?, 'custom')
               ON CONFLICT(name) DO UPDATE SET
                 description = excluded.description,
                 source = 'custom'""",
            [bucket, resolved_description],
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "added": True,
        "category": bucket,
        "path": resolved_path,
        "heading": resolved_heading,
        "description": resolved_description,
    }


def _append_markdown_note(path: Path, heading: str, line: str):
    """Append a single bullet line under a heading in markdown file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    bullet = f"- {timestamp} | {line.strip()}"

    if not path.exists():
        title = path.stem.replace("-", " ").title()
        path.write_text(f"# {title}\n\n{heading}\n{bullet}\n", encoding="utf-8")
        return

    content = path.read_text(encoding="utf-8")
    if bullet in content:
        return

    lines = content.splitlines()
    heading_idx = next((i for i, h in enumerate(lines) if h.strip() == heading), None)

    if heading_idx is None:
        if lines and lines[-1].strip():
            lines.append("")
        lines.extend([heading, bullet])
    else:
        insert_at = heading_idx + 1
        if insert_at < len(lines) and lines[insert_at].strip() == "":
            insert_at += 1
        lines.insert(insert_at, bullet)

    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def _route_learning_logs(entries):
    """Route structured learning notes into long-lived markdown knowledge files."""
    if not entries:
        return []

    routes = get_learning_routes()
    pending_expansion = []

    for entry in entries:
        if not isinstance(entry, dict):
            continue

        bucket = _normalize_category(str(entry.get("bucket", "troubleshooting")))
        title = str(entry.get("title", "")).strip()
        note = str(entry.get("note", "")).strip()
        if not note:
            continue

        line = f"{title}: {note}" if title else note

        if bucket in routes:
            route = routes[bucket]
            _append_markdown_note(route["path"], route["heading"], line)
            _record_learning_event(
                source="learning-log",
                scope="ai_response",
                category=bucket,
                title=title,
                note=note,
                status="captured",
                metadata={"entry": entry},
            )
            continue

        proposed_bucket = bucket or "uncategorized"
        pending_expansion.append(proposed_bucket)
        _append_markdown_note(UNMAPPED_LEARNING_PATH, UNMAPPED_LEARNING_HEADING, line)
        _record_learning_event(
            source="learning-log",
            scope="ai_response",
            category="",
            title=title,
            note=note,
            status="needs_category_expansion",
            requires_category_expansion=True,
            proposed_category=proposed_bucket,
            metadata={"entry": entry},
        )

    return sorted(set(pending_expansion))


def load_decisions(query, limit=5):
    """Search past decisions by keywords. Returns list of dicts."""
    if not DB_PATH.exists():
        return []
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        # Try FTS5 (sanitize query by quoting each term)
        try:
            safe_query = " ".join(f'"{w}"' for w in query.split() if w)
            if not safe_query:
                safe_query = '""'
            rows = conn.execute(
                """SELECT d.summary, d.action, d.source, d.context_notes,
                          d.draft_response, d.decision_at
                   FROM decisions d
                   JOIN decisions_fts fts ON d.id = fts.rowid
                   WHERE decisions_fts MATCH ?
                   ORDER BY d.decision_at DESC LIMIT ?""",
                [safe_query, limit]
            ).fetchall()
        except sqlite3.OperationalError:
            like = f"%{query}%"
            rows = conn.execute(
                """SELECT summary, action, source, context_notes,
                          draft_response, decision_at
                   FROM decisions
                   WHERE summary LIKE ? OR context_notes LIKE ?
                         OR draft_response LIKE ? OR tags LIKE ?
                   ORDER BY decision_at DESC LIMIT ?""",
                [like, like, like, like, limit]
            ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []
    finally:
        conn.close()


def build_context_prompt(batch_items=None):
    """Build the persistent context block injected into every Claude CLI call."""
    ctx = load_context()
    stakeholders = load_stakeholders()
    patterns = load_patterns()

    # Pick relevant stakeholders if batch has sender info
    relevant = {}
    if batch_items:
        senders = set()
        for item in batch_items:
            s = item.get("sender_email", "") or item.get("from", "") or item.get("sender", "")
            if s:
                # Normalize to username
                username = s.split("@")[0].replace(".", "_") if "@" in s else s.lower().replace(" ", "_")
                senders.add(username)
        for key, val in stakeholders.items():
            normalized = key.replace(".", "_")
            if normalized in senders or any(normalized in s for s in senders):
                relevant[key] = val

    priorities_str = "\n".join(f"- {p}" for p in ctx.get("current_priorities", [])) or "None set"
    rules_str = "\n".join(f"- {r}" for r in ctx.get("learned_rules", [])) or "None yet"

    stakeholder_str = ""
    if relevant:
        parts = []
        for name, info in relevant.items():
            parts.append(f"  {name}: {info.get('role', 'unknown')} — {info.get('relationship', '')} — expects response in {info.get('avg_response_expectation', 'unknown')}")
        stakeholder_str = "\n".join(parts)
    else:
        stakeholder_str = "  No matching stakeholders for this batch."

    playbook_str = ""
    known = patterns.get("patterns", [])
    if known:
        parts = []
        for p in known[:10]:
            parts.append(f"  - {p['id']}: trigger={p.get('trigger', '?')}, steps={len(p.get('steps', []))}, used {p.get('times_used', 0)} times")
        playbook_str = "\n".join(parts)
    else:
        playbook_str = "  No playbooks captured yet."

    # Find similar past decisions based on batch item summaries
    decisions_str = ""
    if batch_items:
        seen = set()
        all_decisions = []
        for item in batch_items:
            summary = item.get("summary", "") or item.get("subject", "") or ""
            # Extract key words for search
            words = [w for w in summary.split() if len(w) > 3]
            if words:
                query = " ".join(words[:5])
                for d in load_decisions(query, limit=3):
                    key = d.get("summary", "")
                    if key not in seen:
                        seen.add(key)
                        all_decisions.append(d)
        if all_decisions:
            parts = []
            for d in all_decisions[:5]:
                parts.append(f"  - [{d.get('decision_at', '?')[:10]}] {d.get('action', '?')}: {d.get('summary', '?')}")
                if d.get("draft_response"):
                    parts.append(f"    Response sent: {d['draft_response'][:100]}...")
            decisions_str = "\n".join(parts)

    if not decisions_str:
        decisions_str = "  No similar past decisions found."

    learning_buckets = "|".join(list_learning_buckets())

    return f"""You are eng-buddy, an intelligent work assistant for {ctx.get('role', 'an engineer')} at {ctx.get('company', 'a company')}.
Manager: {ctx.get('manager', 'unknown')}
Team: {ctx.get('team', 'unknown')}
Response tone: {ctx.get('preferences', {}).get('response_tone', 'professional')}

Current priorities:
{priorities_str}

Learned rules (APPLY THESE):
{rules_str}

Relevant stakeholders:
{stakeholder_str}

Known playbooks:
{playbook_str}

Similar past decisions (use these for consistency):
{decisions_str}

AFTER completing your primary task, also output these sections if applicable (as JSON blocks):
- <!--STAKEHOLDER_UPDATES-->: [{{"name": "...", "field": "...", "value": "..."}}]
- <!--NEW_PATTERNS-->: [{{"trigger": "...", "steps": [...], "category": "..."}}]
- <!--AUTOMATION_OPPORTUNITIES-->: [{{"observation": "...", "suggestion": "..."}}]
- <!--LEARNED_RULES-->: ["rule text", ...]
- <!--WORK_TRACES-->: [{{"trigger": "...", "category": "...", "step_observed": "..."}}]
- <!--LEARNING_LOGS-->: [{{"bucket":"{learning_buckets}","title":"...","note":"..."}}]
"""


def parse_learning(claude_response):
    """Parse Claude's response for learning sections and merge into memory."""
    sections = {
        "STAKEHOLDER_UPDATES": _parse_section(claude_response, "STAKEHOLDER_UPDATES"),
        "NEW_PATTERNS": _parse_section(claude_response, "NEW_PATTERNS"),
        "AUTOMATION_OPPORTUNITIES": _parse_section(claude_response, "AUTOMATION_OPPORTUNITIES"),
        "LEARNED_RULES": _parse_section(claude_response, "LEARNED_RULES"),
        "WORK_TRACES": _parse_section(claude_response, "WORK_TRACES"),
        "LEARNING_LOGS": _parse_section(claude_response, "LEARNING_LOGS"),
    }

    if sections["STAKEHOLDER_UPDATES"]:
        sh = load_stakeholders()
        for update in sections["STAKEHOLDER_UPDATES"]:
            name = update.get("name", "")
            if name:
                if name not in sh:
                    sh[name] = {}
                field = update.get("field", "")
                if field:
                    sh[name][field] = update.get("value", "")
                sh[name]["last_updated"] = datetime.now().isoformat()
        _save("stakeholders.json", sh)

    if sections["NEW_PATTERNS"]:
        pt = load_patterns()
        for pattern in sections["NEW_PATTERNS"]:
            pid = pattern.get("category", "unknown") + "-" + str(len(pt["patterns"]))
            pt["patterns"].append({
                "id": pid,
                "trigger": pattern.get("trigger", ""),
                "steps": pattern.get("steps", []),
                "category": pattern.get("category", ""),
                "automation_level": "observe",
                "times_used": 1,
                "detected_at": datetime.now().isoformat(),
            })
        _save("patterns.json", pt)

    if sections["AUTOMATION_OPPORTUNITIES"]:
        pt = load_patterns()
        for opp in sections["AUTOMATION_OPPORTUNITIES"]:
            pt["automation_opportunities"].append({
                "observation": opp.get("observation", ""),
                "suggestion": opp.get("suggestion", ""),
                "status": "pending_review",
                "detected_at": datetime.now().isoformat(),
            })
        _save("patterns.json", pt)

    if sections["LEARNED_RULES"]:
        ctx = load_context()
        existing = set(ctx.get("learned_rules", []))
        for rule in sections["LEARNED_RULES"]:
            if isinstance(rule, str) and rule not in existing:
                ctx.setdefault("learned_rules", []).append(rule)
        _save("context.json", ctx)

    if sections["WORK_TRACES"]:
        tr = load_traces()
        for trace in sections["WORK_TRACES"]:
            tr["traces"].append({
                **trace,
                "timestamp": datetime.now().isoformat(),
            })
        # Cap at 500 traces
        tr["traces"] = tr["traces"][-500:]
        _save("traces.json", tr)

    pending_categories = []
    if sections["LEARNING_LOGS"]:
        pending_categories = _route_learning_logs(sections["LEARNING_LOGS"])

    sections["PENDING_CATEGORY_EXPANSIONS"] = pending_categories
    return sections


def _parse_section(text, section_name):
    """Extract a JSON block between <!--SECTION--> markers."""
    pattern = rf'<!--{section_name}-->\s*(\[.*?\])'
    match = re.search(pattern, text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    return []


def _extract_tool_name_parts(tool_name: str):
    if not tool_name.startswith("mcp__"):
        return "", ""
    parts = tool_name.split("__")
    provider = parts[1] if len(parts) > 1 else ""
    action = parts[2] if len(parts) > 2 else ""
    return provider, action


def _classify_post_tool_category(tool_name: str, tool_input: dict):
    if tool_name in WRITE_TOOLS:
        return "writing-update", ""

    if tool_name in TASK_TOOLS:
        return "task-execution", ""

    if tool_name.startswith("mcp__"):
        provider, _action = _extract_tool_name_parts(tool_name)
        if provider in ACTION_MCP_PROVIDERS:
            return "task-execution", ""
        if provider in READ_ONLY_MCP_PROVIDERS:
            return "", ""

        proposed = _normalize_category(f"integration-{provider or 'unknown'}")
        return "", proposed

    return "", ""


def _summarize_post_tool_learning(tool_name: str, tool_input: dict):
    if not isinstance(tool_input, dict):
        tool_input = {}

    if tool_name in WRITE_TOOLS:
        file_path = str(tool_input.get("file_path", "")).strip()
        if not file_path and isinstance(tool_input.get("files"), list):
            file_path = ", ".join(str(p) for p in tool_input.get("files", [])[:3])
        if file_path:
            return "File update", f"{tool_name} completed on {file_path}"
        return "File update", f"{tool_name} completed"

    if tool_name == "Bash":
        command = str(tool_input.get("command", "")).strip()
        if len(command) > 180:
            command = command[:177] + "..."
        if command:
            return "Task execution", f"Bash command completed: {command}"
        return "Task execution", "Bash command completed"

    if tool_name.startswith("mcp__"):
        provider, action = _extract_tool_name_parts(tool_name)
        provider_label = provider or "unknown"
        action_label = action or "operation"
        return "External integration", f"{provider_label} {action_label} completed"

    return "Task execution", f"{tool_name} completed"


def capture_post_tool_learning(payload: dict):
    """Capture PostToolUse learning into DB/markdown routes."""
    if not isinstance(payload, dict):
        return {"recorded": False, "reason": "invalid_payload"}

    tool_name = str(payload.get("tool_name", "")).strip()
    tool_input = payload.get("tool_input")
    if isinstance(tool_input, str):
        try:
            tool_input = json.loads(tool_input)
        except json.JSONDecodeError:
            tool_input = {"raw": tool_input}
    if not isinstance(tool_input, dict):
        tool_input = {}

    category, proposed_category = _classify_post_tool_category(tool_name, tool_input)
    if not category and not proposed_category:
        return {"recorded": False, "reason": "untracked_tool"}

    title, note = _summarize_post_tool_learning(tool_name, tool_input)
    session_id = str(payload.get("session_id", ""))

    if category:
        routes = get_learning_routes()
        route = routes.get(category)
        if route:
            _append_markdown_note(route["path"], route["heading"], note)
            _record_learning_event(
                session_id=session_id,
                hook_event="PostToolUse",
                source="hook",
                scope="tool_completion",
                tool_name=tool_name,
                category=category,
                title=title,
                note=note,
                status="captured",
                metadata={"tool_input": tool_input},
            )
            return {
                "recorded": True,
                "category": category,
                "needs_category_expansion": False,
                "title": title,
                "note": note,
            }

        proposed_category = category

    # Category couldn't be routed: capture as pending and ask user later.
    _append_markdown_note(UNMAPPED_LEARNING_PATH, UNMAPPED_LEARNING_HEADING, note)
    _record_learning_event(
        session_id=session_id,
        hook_event="PostToolUse",
        source="hook",
        scope="tool_completion",
        tool_name=tool_name,
        category="",
        title=title,
        note=note,
        status="needs_category_expansion",
        requires_category_expansion=True,
        proposed_category=proposed_category,
        metadata={"tool_input": tool_input},
    )
    return {
        "recorded": True,
        "category": "",
        "needs_category_expansion": True,
        "proposed_category": proposed_category,
        "title": title,
        "note": note,
    }


def _cli():
    parser = argparse.ArgumentParser(description="eng-buddy learning engine utilities")
    parser.add_argument("--register-learning-category", dest="register_learning_category", default="")
    parser.add_argument("--description", default="")
    parser.add_argument("--path", default="")
    parser.add_argument("--heading", default="")
    parser.add_argument(
        "--capture-post-tool",
        action="store_true",
        help="Read PostToolUse payload JSON from stdin and capture learning event",
    )

    # --- Playbook Engine Commands ---
    parser.add_argument("--playbook-trace-event", action="store_true",
        help="Record a trace event (reads JSON from stdin: {trace_id, event})")
    parser.add_argument("--playbook-extract", type=str, metavar="TRACE_ID",
        help="Extract a draft playbook from a completed trace")
    parser.add_argument("--playbook-extract-name", type=str, default="Untitled",
        help="Name for the extracted playbook (used with --playbook-extract)")
    parser.add_argument("--playbook-match", type=str, metavar="TEXT",
        help="Find playbooks matching ticket text")
    parser.add_argument("--playbook-match-type", type=str, default="",
        help="Ticket type for matching (used with --playbook-match)")
    parser.add_argument("--playbook-match-source", type=str, default="freshservice",
        help="Source system for matching (used with --playbook-match)")
    parser.add_argument("--playbook-list", action="store_true",
        help="List all approved playbooks")
    parser.add_argument("--playbook-list-drafts", action="store_true",
        help="List all draft playbooks")
    parser.add_argument("--playbook-promote", type=str, metavar="PLAYBOOK_ID",
        help="Promote a draft playbook to approved")

    # --- Task Management Commands ---
    parser.add_argument("--tasks", action="store_true",
        help="List all non-completed tasks")
    parser.add_argument("--tasks-all", action="store_true",
        help="List ALL tasks including completed")
    parser.add_argument("--task", type=int, metavar="N",
        help="Show full detail for task N")
    parser.add_argument("--task-add", action="store_true",
        help="Create a new task (requires --title)")
    parser.add_argument("--task-update", type=int, metavar="N",
        help="Update task N (use with --status, --priority, --deferred-until)")
    parser.add_argument("--task-search", type=str, metavar="KEYWORD",
        help="Full-text search for tasks")
    parser.add_argument("--task-json", action="store_true",
        help="Output task results as JSON instead of table format")
    parser.add_argument("--task-export", type=int, metavar="N",
        help="Export task N as markdown context block")
    parser.add_argument("--title", type=str, default="",
        help="Title for --task-add")
    parser.add_argument("--status", type=str, default="",
        help="Status for --task-update")
    parser.add_argument("--priority", type=str, default="",
        help="Priority for --task-add or --task-update")
    parser.add_argument("--jira-key", type=str, default="",
        help="Jira key for --task-add")
    parser.add_argument("--deferred-until", type=str, default="",
        help="Deferred date for --task-update")

    # --- Ops Tracking Commands ---
    parser.add_argument("--capacity-log", action="store_true",
        help="Add a capacity log entry (requires --metric, --value; optional --date, --notes)")
    parser.add_argument("--stakeholder-add", action="store_true",
        help="Add a stakeholder contact (requires --name; optional --role, --preferences)")
    parser.add_argument("--stakeholder-list", action="store_true",
        help="List all stakeholder contacts (JSON output)")
    parser.add_argument("--incident-add", action="store_true",
        help="Add an incident (requires --title, --severity; optional --timeline)")
    parser.add_argument("--incident-list", action="store_true",
        help="List incidents (JSON output; optional --status filter)")
    parser.add_argument("--pattern-add", action="store_true",
        help="Add a pattern observation (requires --title; optional --type, --description, --confidence)")
    parser.add_argument("--pattern-list", action="store_true",
        help="List pattern observations (JSON output)")
    parser.add_argument("--followup-add", action="store_true",
        help="Add a follow-up item (requires --stakeholder, --topic; optional --due-date)")
    parser.add_argument("--followup-list", action="store_true",
        help="List follow-up items (JSON output; optional --status filter)")
    # Shared optional args for ops commands
    parser.add_argument("--date", type=str, default="",
        help="Date string for --capacity-log")
    parser.add_argument("--metric", type=str, default="",
        help="Metric name for --capacity-log")
    parser.add_argument("--value", type=float, default=None,
        help="Numeric value for --capacity-log")
    parser.add_argument("--notes", type=str, default="",
        help="Notes for --capacity-log or --followup-add")
    parser.add_argument("--name", type=str, default="",
        help="Name for --stakeholder-add")
    parser.add_argument("--role", type=str, default="",
        help="Role for --stakeholder-add")
    parser.add_argument("--preferences", type=str, default="",
        help="Preferences for --stakeholder-add")
    parser.add_argument("--severity", type=str, default="",
        help="Severity for --incident-add or --burnout-add")
    parser.add_argument("--timeline", type=str, default="",
        help="Timeline notes for --incident-add")
    parser.add_argument("--type", type=str, default="",
        dest="obs_type",
        help="Observation type for --pattern-add")
    parser.add_argument("--confidence", type=float, default=None,
        help="Confidence score (0.0-1.0) for --pattern-add")
    parser.add_argument("--stakeholder", type=str, default="",
        help="Stakeholder name for --followup-add or --followup-list")
    parser.add_argument("--topic", type=str, default="",
        help="Topic for --followup-add")
    parser.add_argument("--due-date", type=str, default="",
        help="Due date for --followup-add")

    args = parser.parse_args()

    # --- Task Management Handlers ---
    if args.tasks or args.tasks_all:
        rows = tasks_db.list_tasks(status=None)
        if not args.tasks_all:
            rows = [r for r in rows if r.get("status") != "completed"]
        if args.task_json:
            print(json.dumps(rows, indent=2, default=str))
        else:
            print(f"{'ID':>4}  {'Status':<14}{'Priority':<10}{'Jira':<16}Title")
            print(f"{'--':>4}  {'------':<14}{'--------':<10}{'----':<16}-----")
            for r in rows:
                print(f"{r.get('id', ''):>4}  {r.get('status', ''):<14}{r.get('priority', ''):<10}{(r.get('jira_key') or ''):<16}{r.get('title', '')}")
        return 0

    if args.task is not None:
        t = tasks_db.get_task(args.task)
        if not t:
            print(f"Error: task #{args.task} not found", file=sys.stderr)
            return 1
        if args.task_json:
            print(json.dumps(t, indent=2, default=str))
        else:
            for k, v in t.items():
                print(f"{k:>20}: {v}")
        return 0

    if args.task_add:
        if not args.title:
            print("Error: --title is required for --task-add", file=sys.stderr)
            return 1
        task_id = tasks_db.add_task(
            title=args.title,
            description=args.description or None,
            priority=args.priority or "medium",
            jira_key=args.jira_key or None,
        )
        if args.task_json:
            print(json.dumps({"id": task_id, "title": args.title}))
        else:
            print(f"Created task #{task_id}: {args.title}")
        return 0

    if args.task_update is not None:
        kwargs = {}
        if args.status:
            kwargs["status"] = args.status
        if args.priority:
            kwargs["priority"] = args.priority
        if args.deferred_until:
            kwargs["deferred_until"] = args.deferred_until
        ok = tasks_db.update_task(args.task_update, **kwargs)
        if ok:
            print(f"Updated task #{args.task_update}")
        else:
            print(f"Error: task #{args.task_update} not found or update failed", file=sys.stderr)
            return 1
        return 0

    if args.task_search:
        rows = tasks_db.search_tasks(args.task_search)
        if args.task_json:
            print(json.dumps(rows, indent=2, default=str))
        else:
            print(f"{'ID':>4}  {'Status':<14}{'Priority':<10}{'Jira':<16}Title")
            print(f"{'--':>4}  {'------':<14}{'--------':<10}{'----':<16}-----")
            for r in rows:
                print(f"{r.get('id', ''):>4}  {r.get('status', ''):<14}{r.get('priority', ''):<10}{(r.get('jira_key') or ''):<16}{r.get('title', '')}")
        return 0

    if args.task_export is not None:
        t = tasks_db.get_task(args.task_export)
        if not t:
            print(f"Error: task #{args.task_export} not found", file=sys.stderr)
            return 1
        print(f"## Task #{t['id']}: {t.get('title', '')}")
        print(f"**Jira**: {t.get('jira_key') or 'None'}")
        print(f"**Status**: {t.get('status', '')}")
        print(f"**Priority**: {t.get('priority', '')}")
        print(f"**Description**: {t.get('description') or ''}")
        return 0

    if args.register_learning_category:
        result = register_learning_category(
            name=args.register_learning_category,
            description=args.description,
            path=args.path,
            heading=args.heading,
        )
        print(json.dumps(result))
        return 0

    if args.capture_post_tool:
        payload_text = sys.stdin.read().strip()
        if not payload_text:
            print(json.dumps({"recorded": False, "reason": "empty_payload"}))
            return 0
        try:
            payload = json.loads(payload_text)
        except json.JSONDecodeError:
            print(json.dumps({"recorded": False, "reason": "invalid_json"}))
            return 0

        print(json.dumps(capture_post_tool_learning(payload)))
        return 0

    # --- Playbook Engine Handlers ---
    import os
    PLAYBOOKS_DIR = os.path.expanduser("~/.claude/eng-buddy/playbooks")
    TRACES_DIR = os.path.expanduser("~/.claude/eng-buddy/traces")
    REGISTRY_DIR = os.path.join(PLAYBOOKS_DIR, "tool-registry")

    # Add playbook_engine to sys.path
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "playbook_engine"))

    if args.playbook_trace_event:
        from playbook_engine.tracer import WorkflowTracer, TraceEvent
        payload = json.load(sys.stdin)
        tracer = WorkflowTracer(traces_dir=TRACES_DIR)
        trace_id = payload["trace_id"]
        tracer.load_trace(trace_id) or tracer.start_trace(trace_id)
        event_data = payload["event"]
        tracer.add_event(TraceEvent.from_dict(event_data))
        tracer.flush(trace_id)
        print(json.dumps({"status": "ok", "trace_id": trace_id}))
        return 0

    if args.playbook_extract:
        from playbook_engine.tracer import WorkflowTracer
        from playbook_engine.registry import ToolRegistry
        from playbook_engine.extractor import PlaybookExtractor
        from playbook_engine.manager import PlaybookManager
        tracer = WorkflowTracer(traces_dir=TRACES_DIR)
        trace = tracer.load_trace(args.playbook_extract)
        if not trace:
            print(json.dumps({"error": f"Trace {args.playbook_extract} not found"}))
            return 1
        registry = ToolRegistry(REGISTRY_DIR)
        extractor = PlaybookExtractor(registry=registry)
        pb = extractor.extract_from_trace(trace, name=args.playbook_extract_name)
        manager = PlaybookManager(PLAYBOOKS_DIR)
        path = manager.save_draft(pb)
        print(json.dumps({"status": "ok", "playbook_id": pb.id, "path": path, "steps": len(pb.steps)}))
        return 0

    if args.playbook_match:
        from playbook_engine.manager import PlaybookManager
        manager = PlaybookManager(PLAYBOOKS_DIR)
        matches = manager.match_ticket(
            ticket_type=args.playbook_match_type,
            text=args.playbook_match,
            source=args.playbook_match_source,
        )
        print(json.dumps({"matches": [{"id": m.id, "name": m.name, "confidence": m.confidence, "executions": m.executions} for m in matches]}))
        return 0

    if args.playbook_list:
        from playbook_engine.manager import PlaybookManager
        manager = PlaybookManager(PLAYBOOKS_DIR)
        pbs = manager.list_playbooks()
        print(json.dumps({"playbooks": [{"id": p.id, "name": p.name, "confidence": p.confidence, "version": p.version, "executions": p.executions} for p in pbs]}))
        return 0

    if args.playbook_list_drafts:
        from playbook_engine.manager import PlaybookManager
        manager = PlaybookManager(PLAYBOOKS_DIR)
        drafts = manager.list_drafts()
        print(json.dumps({"drafts": [{"id": d.id, "name": d.name, "confidence": d.confidence, "steps": len(d.steps)} for d in drafts]}))
        return 0

    if args.playbook_promote:
        from playbook_engine.manager import PlaybookManager
        manager = PlaybookManager(PLAYBOOKS_DIR)
        pb = manager.promote_draft(args.playbook_promote)
        if pb:
            print(json.dumps({"status": "ok", "playbook_id": pb.id}))
            return 0
        print(json.dumps({"error": f"Draft {args.playbook_promote} not found"}))
        return 1

    # --- Ops Tracking Handlers ---
    _ensure_ops_schema()

    if args.capacity_log:
        if not args.metric:
            print("Error: --metric is required for --capacity-log", file=sys.stderr)
            return 1
        if args.value is None:
            print("Error: --value is required for --capacity-log", file=sys.stderr)
            return 1
        conn = sqlite3.connect(DB_PATH)
        try:
            cur = conn.execute(
                "INSERT INTO capacity_logs (date, metric, value, notes) VALUES (?, ?, ?, ?)",
                [args.date or date.today().isoformat(), args.metric, args.value, args.notes or ""],
            )
            conn.commit()
            print(json.dumps({"id": cur.lastrowid, "metric": args.metric, "value": args.value}))
        finally:
            conn.close()
        return 0

    if args.stakeholder_add:
        if not args.name:
            print("Error: --name is required for --stakeholder-add", file=sys.stderr)
            return 1
        conn = sqlite3.connect(DB_PATH)
        try:
            cur = conn.execute(
                "INSERT INTO stakeholder_contacts (name, role, preferences) VALUES (?, ?, ?)",
                [args.name, args.role or "", args.preferences or ""],
            )
            conn.commit()
            print(json.dumps({"id": cur.lastrowid, "name": args.name}))
        finally:
            conn.close()
        return 0

    if args.stakeholder_list:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT * FROM stakeholder_contacts ORDER BY created_at DESC"
            ).fetchall()
            print(json.dumps([dict(r) for r in rows], indent=2, default=str))
        finally:
            conn.close()
        return 0

    if args.incident_add:
        if not args.title:
            print("Error: --title is required for --incident-add", file=sys.stderr)
            return 1
        if not args.severity:
            print("Error: --severity is required for --incident-add", file=sys.stderr)
            return 1
        conn = sqlite3.connect(DB_PATH)
        try:
            cur = conn.execute(
                "INSERT INTO incidents (title, severity, timeline) VALUES (?, ?, ?)",
                [args.title, args.severity, args.timeline or ""],
            )
            conn.commit()
            print(json.dumps({"id": cur.lastrowid, "title": args.title, "severity": args.severity}))
        finally:
            conn.close()
        return 0

    if args.incident_list:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            if args.status:
                rows = conn.execute(
                    "SELECT * FROM incidents WHERE status = ? ORDER BY created_at DESC",
                    [args.status],
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM incidents ORDER BY created_at DESC"
                ).fetchall()
            print(json.dumps([dict(r) for r in rows], indent=2, default=str))
        finally:
            conn.close()
        return 0

    if args.pattern_add:
        if not args.title:
            print("Error: --title is required for --pattern-add", file=sys.stderr)
            return 1
        now = datetime.now().isoformat()
        conn = sqlite3.connect(DB_PATH)
        try:
            cur = conn.execute(
                """INSERT INTO pattern_observations
                   (type, title, description, confidence, first_seen, last_seen)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                [
                    args.obs_type or "",
                    args.title,
                    args.description or "",
                    args.confidence if args.confidence is not None else 0.5,
                    now,
                    now,
                ],
            )
            new_id = cur.lastrowid
            # Sync FTS5 index
            conn.execute(
                "INSERT INTO pattern_observations_fts(rowid, title, description, evidence) VALUES (?, ?, ?, ?)",
                [new_id, args.title, args.description or "", ""],
            )
            conn.commit()
            print(json.dumps({"id": new_id, "title": args.title}))
        finally:
            conn.close()
        return 0

    if args.pattern_list:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT * FROM pattern_observations ORDER BY created_at DESC"
            ).fetchall()
            print(json.dumps([dict(r) for r in rows], indent=2, default=str))
        finally:
            conn.close()
        return 0

    if args.followup_add:
        if not args.stakeholder:
            print("Error: --stakeholder is required for --followup-add", file=sys.stderr)
            return 1
        if not args.topic:
            print("Error: --topic is required for --followup-add", file=sys.stderr)
            return 1
        conn = sqlite3.connect(DB_PATH)
        try:
            cur = conn.execute(
                "INSERT INTO follow_ups (stakeholder, topic, due_date, notes) VALUES (?, ?, ?, ?)",
                [args.stakeholder, args.topic, args.due_date or "", args.notes or ""],
            )
            conn.commit()
            print(json.dumps({"id": cur.lastrowid, "stakeholder": args.stakeholder, "topic": args.topic}))
        finally:
            conn.close()
        return 0

    if args.followup_list:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            if args.status:
                rows = conn.execute(
                    "SELECT * FROM follow_ups WHERE status = ? ORDER BY due_date, created_at DESC",
                    [args.status],
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM follow_ups ORDER BY due_date, created_at DESC"
                ).fetchall()
            print(json.dumps([dict(r) for r in rows], indent=2, default=str))
        finally:
            conn.close()
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(_cli())
