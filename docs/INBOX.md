# ftm-inbox

ftm-inbox is an optional background service that polls your work tools (Jira, Freshservice, Slack, Gmail) and surfaces actionable items directly inside the FTM Operator Cockpit dashboard. It runs locally on your machine and never sends data to external services.

## What It Does

Without ftm-inbox, the Operator Cockpit is a static interface. With it:

- Jira issues assigned to you appear as inbox items
- Freshservice tickets awaiting your response are surfaced
- Slack DMs and mentions are queued for triage
- Gmail threads that match configurable filters are included

Each item is stored in a local SQLite database. The FTM skills (`/ftm-mind`, `/ftm-executor`) can read from this inbox to generate plans and take action on your behalf.

## Installation

```bash
npx feed-the-machine --with-inbox
```

This will:

1. Install core FTM skills (same as `npx feed-the-machine`)
2. Copy `ftm-inbox/` to `~/.claude/ftm-inbox/`
3. Run `npm install` for Node dependencies
4. Run `pip3 install -r requirements.txt` for Python dependencies
5. Launch the interactive setup wizard
6. Optionally install a macOS LaunchAgent for auto-start on login

The core `npx feed-the-machine` install (without `--with-inbox`) is completely unchanged.

### Requirements

- Node.js 18+
- Python 3.9+
- `pip3` in PATH

## Configuration

The setup wizard writes credentials to `~/.claude/ftm-inbox/config.yml`. This directory is outside any git repository and should never be committed.

### config.yml reference

```yaml
server:
  port: 8042              # Port for the local API (default: 8042)

adapters:
  jira:
    enabled: true
    base_url: "https://yourorg.atlassian.net"
    email: "you@example.com"
    api_token: "your-jira-api-token"
    poll_interval_seconds: 60

  freshservice:
    enabled: true
    domain: "yourorg.freshservice.com"
    api_key: "your-freshservice-api-key"
    poll_interval_seconds: 120

  slack:
    enabled: true
    bot_token: "xoxb-your-slack-bot-token"
    poll_interval_seconds: 30

  gmail:
    enabled: false
    credentials_path: "~/credentials.json"
    poll_interval_seconds: 120

database:
  path: "~/.claude/ftm-inbox/inbox.db"

logging:
  level: "INFO"
  path: "~/.claude/ftm-inbox/logs"
```

To re-run the wizard after initial setup:

```bash
node ~/.claude/ftm-inbox/bin/setup.mjs
```

To edit manually:

```bash
$EDITOR ~/.claude/ftm-inbox/config.yml
```

## Starting and Stopping

```bash
# Start the service
~/.claude/ftm-inbox/bin/start.sh

# Stop the service
~/.claude/ftm-inbox/bin/stop.sh

# Check status and last poll times
~/.claude/ftm-inbox/bin/status.sh
```

The port can be overridden at runtime:

```bash
FTM_INBOX_PORT=9000 ~/.claude/ftm-inbox/bin/start.sh
```

## Auto-start on Login (macOS)

To generate and load a LaunchAgent that starts ftm-inbox on login:

```bash
node ~/.claude/ftm-inbox/bin/launchagent.mjs
```

This creates `~/Library/LaunchAgents/com.ftm.inbox.plist` and loads it immediately. Logs are written to `~/.claude/ftm-inbox/logs/`.

To remove the LaunchAgent:

```bash
launchctl unload ~/Library/LaunchAgents/com.ftm.inbox.plist
rm ~/Library/LaunchAgents/com.ftm.inbox.plist
```

## Architecture

```
External Services          ftm-inbox                   FTM Skills
──────────────────         ─────────────────────────   ──────────────────
Jira REST API    ──────► Jira Adapter (poller)   ─┐
Freshservice API ──────► Freshservice Adapter    ─┤► SQLite DB ──► FastAPI ──► /ftm-mind
Slack API        ──────► Slack Adapter           ─┤  inbox.db           8042    /ftm-executor
Gmail API        ──────► Gmail Adapter           ─┘
                                                          ▲
                                                          │
                                                    Svelte Dashboard
                                                    (Operator Cockpit)
```

- **Adapters** poll their respective APIs on configurable intervals and write normalized `InboxItem` records to SQLite
- **FastAPI backend** (`backend/main.py`) exposes a REST API at `http://localhost:8042`
- **Svelte dashboard** reads from the API and renders the Operator Cockpit UI
- **FTM skills** use the API to read inbox items and generate or execute plans

## Adding a Custom Poller

1. Create a new file in `ftm-inbox/backend/adapters/`:

```python
# ftm-inbox/backend/adapters/my_service.py
from .base import BaseAdapter, InboxItem
from typing import List

class MyServiceAdapter(BaseAdapter):
    name = "my_service"

    async def fetch(self) -> List[InboxItem]:
        # Hit your API, return a list of InboxItem objects
        items = []
        # ... your logic here ...
        return items
```

2. Add credentials to `~/.claude/ftm-inbox/config.yml`:

```yaml
adapters:
  my_service:
    enabled: true
    api_key: "your-key"
    poll_interval_seconds: 60
```

3. Register it in `ftm-inbox/backend/adapters/__init__.py`:

```python
from .my_service import MyServiceAdapter
ADAPTERS = [..., MyServiceAdapter]
```

4. Restart the service: `~/.claude/ftm-inbox/bin/stop.sh && ~/.claude/ftm-inbox/bin/start.sh`

## Troubleshooting

### Service won't start

Check that Python 3 and uvicorn are installed:
```bash
python3 --version
python3 -c "import uvicorn; print(uvicorn.__version__)"
```

If uvicorn is missing:
```bash
pip3 install -r ~/.claude/ftm-inbox/requirements.txt
```

### No items appearing in the dashboard

1. Check the service is running: `~/.claude/ftm-inbox/bin/status.sh`
2. Check logs: `tail -f ~/.claude/ftm-inbox/logs/*.log`
3. Verify credentials in `~/.claude/ftm-inbox/config.yml`
4. Confirm the adapter is set to `enabled: true`

### Port conflict

If port 8042 is already in use:
```bash
FTM_INBOX_PORT=9042 ~/.claude/ftm-inbox/bin/start.sh
```

Update `config.yml` to match so the dashboard connects to the right port.

### Jira authentication errors

Jira Cloud requires an API token, not your password. Generate one at:
`https://id.atlassian.com/manage-profile/security/api-tokens`

### Freshservice 403 errors

Ensure the API key belongs to an agent with at least Viewer permissions on the relevant groups.

### Re-running setup

```bash
node ~/.claude/ftm-inbox/bin/setup.mjs
```

This overwrites `~/.claude/ftm-inbox/config.yml` but does not touch the database.
