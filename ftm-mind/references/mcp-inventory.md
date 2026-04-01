# MCP Capability Inventory
**Purpose**: Orient-phase reference. Scan input → match domain keywords → select MCP → check approval gate.

---

## 1. Server Catalog

### Development

#### `git`
| Field | Detail |
|-------|--------|
| **Tools** | `git_status`, `git_diff`, `git_diff_staged`, `git_diff_unstaged`, `git_log`, `git_show`, `git_add`, `git_commit`, `git_checkout`, `git_create_branch`, `git_branch`, `git_reset` |
| **When to use** | Checking repo state, reviewing changes, branching, committing, exploring history |
| **When NOT to use** | Detached HEAD state (orphaned commits risk); force-push to main |
| **Approval required** | Auto: `status`, `diff`, `log`, `show`, `branch` (read). Needs approval: `commit`, `push`, `reset`, `checkout` (destructive or state-changing) |

#### `playwright`
| Field | Detail |
|-------|--------|
| **Tools** | `browser_navigate`, `browser_click`, `browser_fill_form`, `browser_type`, `browser_snapshot`, `browser_take_screenshot`, `browser_select_option`, `browser_press_key`, `browser_wait_for`, `browser_evaluate`, `browser_console_messages`, `browser_network_requests`, `browser_tabs`, `browser_close`, `browser_drag`, `browser_hover`, `browser_file_upload`, `browser_handle_dialog`, `browser_resize`, `browser_run_code`, `browser_install` |
| **When to use** | E2E testing, visual verification, UI interaction testing, scraping pages that require JS |
| **When NOT to use** | Headless server environments; when a REST API exists for the same data; anti-bot risk |
| **Approval required** | Auto: `snapshot`, `screenshot`, `console_messages` (read). Needs approval: form submissions, file uploads, any write-through-browser action |

#### `sequential-thinking`
| Field | Detail |
|-------|--------|
| **Tools** | `sequentialthinking` |
| **When to use** | Multi-step reasoning, architecture decisions, complex debugging chains, trade-off analysis |
| **When NOT to use** | Simple single-step lookups — adds latency and token cost without benefit |
| **Approval required** | Auto: analysis only, no side effects |

#### `chrome-devtools`
| Field | Detail |
|-------|--------|
| **Tools** | Chrome DevTools Protocol bridge tools |
| **When to use** | Low-level browser debugging, network inspection, performance profiling of a running Chrome instance |
| **When NOT to use** | General web browsing; prefer `playwright` for test automation |
| **Approval required** | Auto: inspection. Needs approval: any action that modifies browser state or page |

---

### Communication

#### `slack`
| Field | Detail |
|-------|--------|
| **Tools** | `slack_list_channels`, `slack_get_channel_history`, `slack_get_thread_replies`, `slack_post_message`, `slack_reply_to_thread`, `slack_get_users`, `slack_get_user_profile`, `slack_add_reaction` |
| **When to use** | Notifying team, posting updates, searching conversation history, replying to threads |
| **When NOT to use** | Sending sensitive credentials or PII; bulk messaging that looks like spam |
| **Approval required** | Auto: `list_channels`, `get_channel_history`, `get_thread_replies`, `get_users`, `get_user_profile` (read). Needs approval: `post_message`, `reply_to_thread`, `add_reaction` (write to Slack) |

#### `gmail`
| Field | Detail |
|-------|--------|
| **Tools** | `search_emails`, `read_email`, `draft_email`, `send_email`, `delete_email`, `modify_email`, `batch_modify_emails`, `batch_delete_emails`, `create_label`, `update_label`, `delete_label`, `list_email_labels`, `create_filter`, `create_filter_from_template`, `get_filter`, `list_filters`, `delete_filter`, `get_or_create_label`, `download_attachment` |
| **When to use** | Email triage, searching inbox, drafting replies, managing labels/filters |
| **When NOT to use** | Bulk delete without confirmation; sending on behalf of user without explicit approval |
| **Approval required** | Auto: `search_emails`, `read_email`, `list_email_labels`, `get_filter`, `list_filters` (read). Needs approval: `send_email`, `delete_email`, `batch_delete_emails`, `batch_modify_emails`, `create_filter` (write/destructive) |

---

### Project Management

#### `mcp-atlassian-personal` (personal Jira + Confluence account) {#atlassian-personal}

> **Config note**: This server name is the default. The actual name is read from `ops.mcp_account_rules.personal` in `ftm-config.yml`. Update that value to change which MCP server is used for personal Atlassian operations.
| Field | Detail |
|-------|--------|
| **Tools** | Jira: `jira_search`, `jira_get_issue`, `jira_create_issue`, `jira_update_issue`, `jira_delete_issue`, `jira_transition_issue`, `jira_add_comment`, `jira_edit_comment`, `jira_get_transitions`, `jira_get_all_projects`, `jira_get_project_issues`, `jira_get_board_issues`, `jira_get_sprint_issues`, `jira_get_sprints_from_board`, `jira_get_agile_boards`, `jira_create_sprint`, `jira_update_sprint`, `jira_add_issues_to_sprint`, `jira_batch_create_issues`, `jira_create_issue_link`, `jira_remove_issue_link`, `jira_get_link_types`, `jira_add_worklog`, `jira_get_worklog`, `jira_add_watcher`, `jira_remove_watcher`, `jira_get_issue_watchers`, `jira_get_user_profile`, `jira_download_attachments`, `jira_get_issue_images`, `jira_link_to_epic`, `jira_get_project_components`, `jira_get_project_versions`, `jira_batch_create_versions`, `jira_create_version`, `jira_get_issue_sla`, `jira_get_issue_dates`, `jira_get_issue_development_info`, `jira_get_issues_development_info`, `jira_batch_get_changelogs`, `jira_get_queue_issues`, `jira_get_service_desk_for_project`, `jira_get_service_desk_queues`, `jira_create_remote_issue_link`, `jira_search_fields`, `jira_get_field_options`, `jira_get_issue_proforma_forms`, `jira_get_proforma_form_details`, `jira_update_proforma_form_answers` | Confluence: `confluence_search`, `confluence_get_page`, `confluence_create_page`, `confluence_update_page`, `confluence_delete_page`, `confluence_add_comment`, `confluence_reply_to_comment`, `confluence_get_comments`, `confluence_add_label`, `confluence_get_labels`, `confluence_get_page_children`, `confluence_get_page_history`, `confluence_get_page_diff`, `confluence_get_page_views`, `confluence_move_page`, `confluence_upload_attachment`, `confluence_upload_attachments`, `confluence_get_attachments`, `confluence_delete_attachment`, `confluence_download_attachment`, `confluence_download_content_attachments`, `confluence_get_page_images`, `confluence_search_user` |
| **When to use** | Tracking personal tickets, updating your own issues, commenting, logging work, searching your Jira backlog, reading/writing Confluence docs |
| **When NOT to use** | IT admin operations (use `mcp-atlassian` instead); service desk ticket management (use `freshservice-mcp`) |
| **Approval required** | Auto: all `get_*`, `search*`, `list_*`, `download_*` (read). Needs approval: `create_issue`, `update_issue`, `delete_issue`, `transition_issue`, `add_comment`, `create_page`, `update_page`, `delete_page`, `add_worklog` |

#### `mcp-atlassian` (IT admin Jira + Confluence account) {#atlassian-admin}

> **Config note**: This server name is the default. The actual name is read from `ops.mcp_account_rules.admin` in `ftm-config.yml`.
| Field | Detail |
|-------|--------|
| **Tools** | Same tool set as `mcp-atlassian-personal` |
| **When to use** | IT admin operations, organization-wide Jira/Confluence actions requiring admin credentials |
| **When NOT to use** | Personal work — use `mcp-atlassian-personal` to avoid admin footprint on personal tickets |
| **Approval required** | Same gate as personal; extra caution given admin scope — all writes need approval |

---

### Service Desk

#### `freshservice-mcp`
| Field | Detail |
|-------|--------|
| **Tools** | Tickets: `get_tickets`, `get_ticket_by_id`, `create_ticket`, `update_ticket`, `delete_ticket`, `get_ticket_fields`, `filter_tickets`, `list_all_ticket_conversation`, `create_ticket_note`, `send_ticket_reply`, `get_requested_items` | Agents/Requesters: `get_all_agents`, `get_agent`, `create_agent`, `update_agent`, `filter_agents`, `get_all_requesters`, `get_requester_id`, `create_requester`, `update_requester`, `filter_requesters`, `list_all_requester_fields`, `get_all_requester_groups`, `get_requester_groups_by_id`, `create_requester_group`, `update_requester_group`, `list_requester_group_members`, `add_requester_to_group` | Groups/Products: `get_all_agent_groups`, `getAgentGroupById`, `create_group`, `update_group`, `get_all_products`, `get_products_by_id`, `create_product`, `update_product` | Solutions/Canned: `get_all_solution_category`, `get_solution_category`, `create_solution_category`, `update_solution_category`, `get_list_of_solution_folder`, `get_solution_folder`, `create_solution_folder`, `update_solution_folder`, `get_list_of_solution_article`, `get_solution_article`, `create_solution_article`, `update_solution_article`, `publish_solution_article`, `list_all_canned_response_folder`, `list_canned_response_folder`, `get_all_canned_response`, `get_canned_response` | Service: `create_service_request`, `list_service_items` | Workspace: `get_workspace`, `list_all_workspaces` |
| **When to use** | IT service desk tickets, hardware requests, onboarding/offboarding, software access requests, agent/group management |
| **When NOT to use** | Engineering project tracking (use Jira); general team comms (use Slack) |
| **Approval required** | Auto: all `get_*`, `filter_*`, `list_*` (read). Needs approval: `create_ticket`, `update_ticket`, `delete_ticket`, `send_ticket_reply`, `create_ticket_note`, `create_service_request`, `create_agent`, `update_agent` |

---

### Documentation & Knowledge

#### `context7`
| Field | Detail |
|-------|--------|
| **Tools** | `resolve-library-id`, `get-library-docs` |
| **When to use** | Library/framework API docs, "how do I use X library", version-specific documentation lookup |
| **When NOT to use** | Internal company docs (use Confluence/Glean); saved personal reading (use Readwise if configured) |
| **Approval required** | Auto: all read-only |

#### `glean_default`
| Field | Detail |
|-------|--------|
| **Tools** | `chat`, `search`, `read_document` |
| **When to use** | Searching internal Klaviyo knowledge base, finding internal docs, policies, runbooks, past decisions |
| **When NOT to use** | External library docs (use context7); real-time web search (use WebSearch tool) |
| **Approval required** | Auto: all read-only |

#### `apple-doc-mcp`
| Field | Detail |
|-------|--------|
| **Tools** | `list_technologies`, `get_documentation`, `search_symbols`, `list_container_technologies`, `get_container_documentation`, `search_container_symbols`, `list_containerization_technologies`, `get_containerization_documentation`, `search_containerization_symbols`, `check_updates` |
| **When to use** | Apple platform development (Swift, SwiftUI, UIKit, AppKit), containerization docs for Apple frameworks |
| **When NOT to use** | Non-Apple development contexts; general web docs |
| **Approval required** | Auto: all read-only |

---

### People & CRM

#### `lusha`
| Field | Detail |
|-------|--------|
| **Tools** | `contactSearch`, `contactEnrich`, `personBulkLookup`, `companySearch`, `companyEnrich`, `companyBulkLookup`, `contactFilters`, `companyFilters` |
| **When to use** | Finding contact info for a person or company, enriching a lead with email/phone, company intelligence lookups |
| **When NOT to use** | Internal employee lookups (use Slack/Glean); existing contacts already in CRM |
| **Approval required** | Auto: all search/enrich (read from Lusha). Needs approval if results are being written somewhere |

---

### Calendar

#### `google-calendar`
| Field | Detail |
|-------|--------|
| **Tools** | `list-calendars`, `list-events`, `get-event`, `search-events`, `create-event`, `create-events`, `update-event`, `delete-event`, `respond-to-event`, `get-freebusy`, `get-current-time`, `list-colors`, `manage-accounts` |
| **When to use** | Checking schedule, finding free time, creating/updating meetings, responding to invites, scheduling across participants |
| **When NOT to use** | Non-calendar scheduling (use Jira for sprint planning) |
| **Approval required** | Auto: `list-calendars`, `list-events`, `get-event`, `search-events`, `get-freebusy`, `get-current-time`, `list-colors` (read). Needs approval: `create-event`, `update-event`, `delete-event`, `respond-to-event` |

---

## 2. Contextual Trigger Map

| User says / context contains... | Reach for... | Tool category |
|----------------------------------|--------------|---------------|
| "commit", "push", "branch", "PR", "git log", "diff", "staged" | `git` | Version control |
| "Jira", "ticket", "sprint", "story", "epic", "backlog", "SCRUM" | `mcp-atlassian-personal` | Project mgmt |
| "IT ticket", "service request", "Freshservice", "hardware request", "onboarding", "access request" | `freshservice-mcp` | Service desk |
| "Confluence", "wiki", "internal doc", "runbook", "write a page" | `mcp-atlassian-personal` | Documentation |
| "Slack", "post to channel", "notify the team", "DM", "thread" | `slack` | Communication |
| "email", "Gmail", "inbox", "draft", "reply to", "send to" | `gmail` | Communication |
| "calendar", "meeting", "schedule", "free time", "invite", "block time" | `google-calendar` | Calendar |
| "how do I use [library]", "API docs", "documentation for X framework" | `context7` | Ext. docs |
| "find in internal docs", "Glean", "search Klaviyo", "company policy" | `glean_default` | Internal knowledge |
| "screenshot", "test the UI", "click button", "E2E", "browser test" | `playwright` | Testing |
| "find someone's email", "contact info", "company profile", "person lookup" | `lusha` | CRM/people |
| "Swift docs", "SwiftUI", "UIKit", "Apple framework", "AppKit" | `apple-doc-mcp` | Apple dev |
| "think through this", "complex analysis", "multi-step reasoning", "trade-offs" | `sequential-thinking` | Reasoning |
| "debug browser", "network request", "Chrome DevTools", "performance profile" | `chrome-devtools` | Dev tools |
| "who is oncall", "search internal", "Klaviyo runbook" | `glean_default` | Internal ops |
| "IT admin", "org-wide Jira change", "admin Confluence" | `mcp-atlassian` | Admin ops |
| "highlight", "saved article", "Readwise", "reading list" | *(Readwise — not configured in current settings)* | — |

---

## 3. Multi-MCP Workflows

### W1: Jira Ticket → Research → Implement → PR → Notify Team
```
1. mcp-atlassian-personal.jira_get_issue          → read ticket details
2. context7.get-library-docs                       → research relevant APIs
3. git.git_status + git.git_create_branch          → prep branch
4. [implement code changes]
5. git.git_add + git.git_commit                    → commit work
6. slack.slack_post_message                        → notify team of PR
```

### W2: Calendar Check → Draft Message → Email Follow-up
```
1. google-calendar.get-freebusy                    → find mutual availability
2. google-calendar.search-events                   → context on existing meetings
3. slack.slack_post_message OR slack.slack_reply_to_thread  → async coordination
4. gmail.draft_email                               → formal follow-up (needs approval to send)
5. google-calendar.create-event                    → book the slot (needs approval)
```

### W3: IT Service Request → Jira Tracking → Slack Update
```
1. freshservice-mcp.get_ticket_by_id               → read service request
2. mcp-atlassian-personal.jira_create_issue        → create linked engineering task (needs approval)
3. freshservice-mcp.update_ticket                  → update FS ticket with Jira link (needs approval)
4. slack.slack_post_message                        → notify requester's team (needs approval)
```

### W4: Bug Report → Code Investigation → Fix → Test → Close
```
1. mcp-atlassian-personal.jira_get_issue           → read bug details
2. git.git_log + git.git_diff                      → inspect recent changes
3. glean_default.search                            → search internal runbooks for context
4. [implement fix]
5. playwright.browser_navigate + browser_snapshot  → visual smoke test
6. git.git_add + git.git_commit                    → commit fix
7. mcp-atlassian-personal.jira_transition_issue    → close/resolve ticket (needs approval)
```

### W5: New Hire Onboarding Request → Access Provisioning → Confirm
```
1. freshservice-mcp.get_ticket_by_id               → read onboarding request
2. mcp-atlassian-personal.jira_create_issue        → create IT tasks (needs approval)
3. lusha.contactEnrich                             → enrich new hire contact info if needed
4. freshservice-mcp.create_requester               → add to Freshservice (needs approval)
5. slack.slack_post_message                        → notify IT and manager (needs approval)
6. gmail.draft_email                               → welcome email (needs approval to send)
```

### W6: Architecture Research → Documentation → Team Sync
```
1. context7.get-library-docs                       → library/framework research
2. glean_default.search                            → find existing internal decisions
3. sequential-thinking.sequentialthinking          → synthesize trade-offs
4. mcp-atlassian-personal.confluence_create_page   → write decision doc (needs approval)
5. slack.slack_post_message                        → share with team (needs approval)
6. google-calendar.create-event                    → schedule review meeting (needs approval)
```

---

## 4. Approval Gate Annotations

### Auto-execute (safe — read/query/list only)
| Operation type | Examples |
|----------------|---------|
| Read git state | `git_status`, `git_diff`, `git_log`, `git_show`, `git_branch` |
| Search/list Jira | `jira_search`, `jira_get_issue`, `jira_get_all_projects`, `jira_get_sprint_issues` |
| Read Confluence | `confluence_get_page`, `confluence_search`, `confluence_get_comments` |
| Read Freshservice | `get_tickets`, `get_ticket_by_id`, `filter_tickets`, `get_all_agents` |
| Read calendar | `list-events`, `get-event`, `search-events`, `get-freebusy`, `get-current-time` |
| Read Slack | `list_channels`, `get_channel_history`, `get_thread_replies`, `get_users` |
| Read Gmail | `search_emails`, `read_email`, `list_email_labels` |
| Lookup contacts | `lusha.contactSearch`, `lusha.companySearch`, `lusha.contactEnrich` |
| Read docs | `context7.get-library-docs`, `glean_default.search`, `apple-doc-mcp.*` |
| Browser inspect | `playwright.browser_snapshot`, `browser_screenshot`, `browser_console_messages` |
| Analysis | `sequential-thinking.sequentialthinking` |

### Needs approval (write / mutate / send / delete)
| Operation type | Examples |
|----------------|---------|
| Git write | `git_commit`, `git_checkout`, `git_reset`, `git_create_branch` |
| Jira write | `jira_create_issue`, `jira_update_issue`, `jira_delete_issue`, `jira_transition_issue`, `jira_add_comment`, `jira_add_worklog` |
| Confluence write | `confluence_create_page`, `confluence_update_page`, `confluence_delete_page`, `confluence_add_comment` |
| Freshservice write | `create_ticket`, `update_ticket`, `delete_ticket`, `send_ticket_reply`, `create_ticket_note`, `create_service_request`, `create_agent`, `update_agent` |
| Calendar write | `create-event`, `update-event`, `delete-event`, `respond-to-event` |
| Slack write | `slack_post_message`, `slack_reply_to_thread`, `slack_add_reaction` |
| Gmail write | `send_email`, `draft_email`, `delete_email`, `batch_delete_emails`, `create_filter` |
| Browser actions | Form submissions, file uploads, page mutations via Playwright |

> **Hook enforcement**: `settings.json` registers a `PreToolUse` guard script on `mcp__mcp-atlassian-personal`, `mcp__mcp-atlassian`, `mcp__freshservice-mcp`, `mcp__slack`, and `mcp__gmail`. The guard will intercept write operations — treat any tool in those namespaces as needing user confirmation before proceeding.

---

## 5. Mind Integration Notes (Orient Phase)

### Scan → Match → Gate → Chain

```
INPUT SCAN (keywords, intent, entities)
  │
  ├── Domain keyword detected?
  │     └── Yes → look up Contextual Trigger Map (Section 2)
  │
  ├── Single domain or multi-domain?
  │     ├── Single → pick direct MCP tool
  │     └── Multi  → pick workflow from Section 3 or compose ad-hoc chain
  │
  ├── Approval gate check (Section 4)
  │     ├── Read-only? → auto-proceed
  │     └── Write/send/delete? → surface to user for confirmation
  │
  └── Execute → synthesize result → continue OODA loop
```

### Orient heuristics

1. **Prefer read before write**: Always gather current state (`get_issue`, `git_status`, `list-events`) before proposing mutations.
2. **Parallel reads are safe**: `jira_get_issue` + `glean_default.search` + `git_log` can run concurrently — no side effects.
3. **Chain writes sequentially**: Write operations must be user-confirmed and ordered — never batch-execute multiple destructive actions.
4. **Use personal over admin**: Default to `mcp-atlassian-personal` unless the task explicitly requires IT admin scope.
5. **Match specificity**: IT/hardware/access → Freshservice. Engineering work → Jira. Internal knowledge → Glean. External library → context7. Personal saved reading → Readwise (not currently configured).
6. **Stop after answer**: If a single read resolves the question, stop. Do not escalate to `sequential-thinking` for simple factual lookups.
7. **Guard hook awareness**: Slack, Gmail, Atlassian, and Freshservice write operations are intercepted by the external-action-guard hook — do not attempt to batch them silently.
