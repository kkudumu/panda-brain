# Freshservice Service Catalog Item — Creation Playbook

## Purpose

Reference framework for FTM agents creating Freshservice service catalog items via
ftm-browse. This is NOT an exact replay script — it documents the UI structure,
interaction patterns, field requirements, and decision points so an agent can
navigate the Freshservice admin UI with context.

## Execution Method

**Primary: ftm-browse (headless Playwright)** — while a POST API exists for service
catalog items (`POST /api/v2/service_catalog/items`), it cannot configure the form
builder (custom fields, role dropdowns, content fields). The agent must drive the
browser UI for full item creation with form configuration.

**API capabilities (for reference):**
- `GET /api/v2/service_catalog/items` — list all items (use to verify creation)
- `GET /api/v2/service_catalog/items/{id}` — view specific item
- `POST /api/v2/service_catalog/items` — create item (basic fields only, no form builder)
- `PUT` — NOT supported (cannot update items via API)

**Hybrid approach:** Use ftm-browse for item creation + form builder configuration,
then use Freshservice MCP for verification, custom object creation, and reads.

**Auth model:** User authenticates manually (Okta SSO + MFA), then the agent takes
over. The agent should:
1. Launch ftm-browse and navigate to Freshservice
2. Pause and ask the user to complete SSO login
3. Resume automation after user confirms login

## Entry Points

| Starting Point | URL Pattern | When to Use |
|---|---|---|
| Service Catalog list | `https://klaviyo.freshservice.com/ws/2/catalog/items` | Browsing/searching existing items |
| Specific item (edit) | `https://klaviyo.freshservice.com/ws/2/catalog/items/{id}/edit` | Editing an existing item |
| Admin search | Admin → search "service" → "Service Catalog" link | When starting from admin panel |

## Template Strategy

**Always clone from a template, never create from scratch.**

| Template | Name in UI | When to Use |
|---|---|---|
| Standard app onboarding | `IT Workflow V2 Template - App` | Default for all SSO app service catalog items |

**How to clone:**
1. Search for the template in Service Catalog (search box: `template`)
2. Open the template item
3. Use the split-button dropdown (`.btn-group > button:nth-child(2)`) → **Save As**
4. Enter new item name in `#save_as_item_name`
5. Click Save — this creates a new item based on the template

## Required Fields

### Item Metadata (left sidebar)

| Field | Selector | Content | Source |
|---|---|---|---|
| **Item Name** | `#save_as_item_name` (on clone) | App name as it appears in Okta | SSO ticket or Okta admin |
| **Short Description** | `#item_short_description` | Brief label (usually same as item name or "[App] access request") | Manual |
| **Description** | `.redactor_editor` (first instance) | What the app does — 1-2 sentences | SSO ticket field "High-level description of the application" or vendor docs |

### Form Builder (main area)

The form builder is a drag-and-drop interface. The template pre-populates a **Role**
field. Additional fields are added by dragging field types from the palette.

#### Role Field (pre-populated from template)

The Role field is a **custom object dropdown** that lists the app's roles.

**Configuration steps:**
1. Click the Role field in the form → opens editor
2. Find the "app name" label (under "For Agents" section)
3. Click **"Enter Text"** button (CRITICAL — you cannot type directly, must click this button first)
4. Replace the placeholder name with the actual app name in `input[name="custom-input"]`
5. Click Submit → Done

**Data source:** The Role field pulls from a custom object. The custom object records
(one per role) must be created separately — see "Custom Objects" section below.

#### "Why do you need access?" Field (add manually)

| Property | Value |
|---|---|
| **Field type** | Paragraph (`.ficon-sr_paragraph`) |
| **Label** | `Why do you need access to this role?` |
| **Placeholder** | `Please be as descriptive as possible.` |
| **Display to approver** | Checked |
| **Mandatory** | Checked |

**How to add:**
1. Drag paragraph field type from palette into form area
2. Click field to open editor
3. Set label in `input[name="customlabel"]`
4. Set placeholder in `input[name="customplaceholder"]`
5. Check "Display to approver" and "Mandatory Field" checkboxes
6. Click Done

#### Access Scope Field (optional but recommended)

A **Content** field that describes what each role can do. Helps requesters choose
the right role.

**Format example:**
```
Owners — Full administrative access, manage all settings
Admin — Create users, assign strategies, manage security configurations
Members — Standard access, view-only for most settings
```

**Note:** Freshservice content fields have limited formatting — no font size control.
If longer descriptions are needed, use a Content field with line breaks.

#### Additional Field Types Available

The form builder palette includes these field types (for future use):

| Type | Icon Class | Use Case |
|---|---|---|
| Text | single-line input | Short text answers |
| Paragraph | `.ficon-sr_paragraph` | Long text (justifications, descriptions) |
| Checkbox | checkbox input | Boolean flags |
| Dropdown | select input | Fixed choice lists or custom object data source |
| Multi-Select Dropdown | multi-select | Multiple selections (e.g., multiple roles) |
| Lookup | object lookup | Hierarchical relationships (max 10 per form) |
| Content | rich text block | Instructions, role descriptions, guidance text |
| Shared Fields | reusable fields | Cross-item reusable fields managed centrally |

**Dynamic sections:** Forms support conditional field visibility — certain sections
show/hide based on a dropdown selection. Useful for apps with role-specific fields.

### Saving

**CRITICAL: Use "Save As" when cloning, "Save & Publish" when the item is ready.**

| Action | When | Button |
|---|---|---|
| Save As | Cloning from template (first save only) | Split-button dropdown → "Save As" |
| Save | Intermediate saves during editing | Primary save button |
| Save & Publish | Item is complete and ready for users | Split-button dropdown → "Save & Publish" |

## Custom Objects

Each app needs custom object records for its roles. These link to the Role dropdown
in the service catalog item.

### Fields per Custom Object Record

| Field | Description | Example |
|---|---|---|
| App Name | The application name | `Clover Security` |
| Role | The role name | `Members`, `Admin`, `Owners` |
| Okta Group ID | The Okta group that grants this role | (from Okta admin or API) |

### Creating Custom Object Records

**Can be done via Freshservice MCP** (unlike service catalog items):
- Navigate to Admin → Custom Objects → find the app's object
- Create one record per role

**Or via Ragnarok/Claude Code:**
- Use Freshservice API to create custom object records programmatically
- Requires: app name, role names, Okta group IDs

**Tip:** If Okta group IDs are unknown, the agent can query Okta API or ask the user.
Pattern from transcript: "get the Okta group ID for group name [X] from Okta"

## Workflow / Custom Trigger

After the service catalog item is created, it needs a workflow trigger to handle
request fulfillment.

### Trigger Selection

| Approval Pattern | Trigger Name | When to Use |
|---|---|---|
| App owner only (no manager) | `assign_after_app_owner_approval` | Default for most apps |
| Manager + app owner | TBD — check custom trigger list | Apps requiring manager sign-off |
| Auto-assign on request | `auto_assign_upon_request` | Low-risk roles (e.g., Members) |

**Reference:** Full list of custom triggers is maintained in an internal document
(ask the team or check Ragnarok docs).

### Creating the Trigger

**Preferred method:** Ragnarok slash commands or Claude Code with Freshservice API

**Required inputs:**
- Service catalog item ID (from URL after creation, e.g., `/catalog/items/620/edit` → ID is `620`)
- Trigger name (from table above)
- App name

**Fallback method:** Workflow Automator in Freshservice admin
- Admin → Workflow Automator
- Use Seth's template if available
- Link to the service catalog item

## UI Interaction Gotchas

These are non-obvious behaviors discovered through usage:

1. **"Enter Text" button:** The Role field's app name cannot be typed directly. You MUST click the "Enter Text" button first, which opens an input field. This is the `input[name="custom-input"]` element.

2. **Split-button dropdown:** Save/Publish/Save As are behind a split button. The primary button does "Save". The dropdown arrow (`.btn-group > button:nth-child(2)`) reveals "Save As" and "Save & Publish".

3. **Template overwrite risk:** If you click "Save" instead of "Save As" when editing a template, you overwrite the template. Always clone first.

4. **Page context after SSO:** After Okta SSO login, the browser may land on the Okta dashboard, not Freshservice. The agent may need to: search for "Freshworks" in Okta app search → launch → click "FreshService Klaviyo" link.

5. **Popup windows:** Freshservice may open in a new tab/popup from Okta. The agent needs to handle tab switching (`$PB tabs` to list, then navigate in the correct tab).

6. **Content field formatting:** No rich text formatting in content fields used for role descriptions. Use plain text with line breaks.

## Agent Workflow Summary

```
1. Launch ftm-browse
2. Navigate to Freshservice (via direct URL or Okta)
3. PAUSE — ask user to authenticate (Okta SSO + MFA)
4. User confirms login
5. Navigate to Service Catalog admin
6. Search for template ("IT Workflow V2 Template - App")
7. Open template → Save As → enter new app name
8. Configure Role field (Enter Text → set app name)
9. Add "Why do you need access?" paragraph field
10. Fill item metadata (short description, description)
11. Optionally add Access Scope content field
12. Save & Publish
13. Note the item ID from URL
14. Create custom object records (via MCP or Ragnarok)
15. Set up custom trigger (via Ragnarok or Workflow Automator)
```

## Key Selectors Reference

These are ARIA roles and selectors observed in the Freshservice UI. Use `$PB snapshot -i`
to get fresh refs — never hardcode @e refs across sessions.

| Element | Selector Strategy | Notes |
|---|---|---|
| Admin menu | `role: menuitem, name: "Admin"` | Main nav |
| Admin search | `role: textbox, name: "Search admin"` | Type to filter admin sections |
| Service Catalog link | `role: link, name: "Service Catalog Manage list"` | In admin search results |
| Item search | `role: textbox, name: "Search service items"` | Filter catalog items |
| Template link | `role: link, name: contains "Template"` | Find templates |
| Save As trigger | `.btn-group > button:nth-child(2)` then `role: link, name: "Save As"` | Split button |
| Save As name input | `#save_as_item_name` | Clone name field |
| Short description | `#item_short_description` | Item sidebar |
| Description editor | `.redactor_editor` (first) | Rich text area |
| Role field editor | Click the role section in form builder | Opens modal |
| Enter Text button | text: "Enter Text" | Required before typing app name |
| Custom input | `input[name="custom-input"]` | App name in role config |
| Field label input | `input[name="customlabel"]` | When adding new fields |
| Field placeholder | `input[name="customplaceholder"]` | When adding new fields |
| Paragraph field type | `.ficon-sr_paragraph` | Drag to add paragraph |
| Display to approver | `role: checkbox, name: "Display to approver"` | Field option |
| Mandatory checkbox | `role: checkbox, name: "Mandatory Field"` | Field option |
| Done button | `role: button, name: "Done"` | Close field editor |
| Save & Publish | Split button dropdown → `role: link, name: "Save & Publish"` | Final publish |
| Delete field | `.delete_wrapper > .icon-trash` | Remove unwanted template fields |
| Confirm delete | `#confirmModal-submit` | Confirm field deletion |

## Information the Agent Needs from the User

Before starting, collect:

| Input | Required? | Source |
|---|---|---|
| **App name** (as in Okta) | Yes | User or SSO ticket |
| **Short description** | Yes (can default to app name) | User |
| **App description** | Yes | SSO ticket or user |
| **Role names** | Yes | User or SSO ticket |
| **Role descriptions** | Recommended | User or vendor docs |
| **Okta group IDs per role** | For custom objects | Okta API or user |
| **Approval pattern** | Yes (default: owner-only) | User |
| **Who are the approvers?** | For trigger setup | User |
