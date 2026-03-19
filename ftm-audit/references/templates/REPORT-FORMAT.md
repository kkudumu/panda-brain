# Audit Report Format

The final output structure for a completed ftm-audit run.

---

## Summary Report

```
## FTM Audit Report — [YYYY-MM-DD HH:MM]

### Layer 1: Static Analysis (knip)
- Findings: [N]
- [FINDING_TYPE] file:line — description
- [FINDING_TYPE] file:line — description

### Layer 2: Adversarial Audit
- Findings: [N]
- [FINDING_TYPE] file:line — description (Dimension N FAIL)
- [FINDING_TYPE] file:line — description (Dimension N FAIL)

### Layer 3: Auto-Fix Results
- Fixed: [N]
- Manual intervention needed: [N]
- [list each fix applied with result]

### Final Status: PASS / FAIL
- Remaining issues: [list if any]
```

---

## Detailed Changelog

Produced alongside the summary report when Layer 3 runs.

```
### FTM Audit Changelog — [YYYY-MM-DD HH:MM]

#### Findings
| # | Type | Location | Description |
|---|------|----------|-------------|
| 1 | UNWIRED_COMPONENT | src/components/Widget.tsx | Imported but not rendered in Dashboard |
| 2 | ORPHAN_ROUTE | src/views/Settings.tsx | No route config entry |

#### Fixes Applied
| # | Finding | Fix | Verified |
|---|---------|-----|----------|
| 1 | UNWIRED_COMPONENT Widget | Added <Widget /> to Dashboard.tsx:47 | ✅ PASS |
| 2 | ORPHAN_ROUTE Settings | Added /settings route to router.tsx:23 | ✅ PASS |

#### Manual Intervention Required
| # | Finding | Reason | Suggested Action |
|---|---------|--------|-----------------|
| (none) | | | |

#### Final Status: PASS (0 remaining issues)
```

---

## Layer-by-Layer Finding Format

### Layer 1 (knip) Finding Format

```
Layer 1 findings:
- [UNUSED_FILE] src/components/OldWidget.tsx — not imported anywhere
- [UNUSED_EXPORT] src/utils/helpers.ts:42 — export `formatDate` not used
- [UNUSED_DEP] package.json — `lodash` listed but never imported
- [UNLISTED_DEP] src/api/client.ts — imports `axios` but it's not in package.json
```

### Layer 2 (Adversarial) Finding Format

```
Layer 2 findings:
- [UNWIRED_COMPONENT] src/components/NewWidget.tsx — imported in Dashboard.tsx:5 but never rendered in JSX (Dimension 2 FAIL)
- [ORPHAN_ROUTE] src/views/SettingsView.tsx — no route in router config points to this view (Dimension 3 FAIL)
- [DEAD_STORE_FIELD] src/store/userSlice.ts:23 — `userPreferences` written in reducer but never read by any selector (Dimension 4 FAIL)
- [UNCALLED_API] src/api/billing.ts:15 — `fetchInvoices()` exported but never called (Dimension 5 FAIL)
```

**Requirement:** Every finding must include file:line evidence. "I think this might be unused" is not acceptable — show the grep results or the missing link in the chain.

### Phase 3 (Runtime) Finding Format

When runtime-only findings are present (passed Layers 1-2 but failed Phase 3):

```
Phase 3 (Runtime) findings:
- [RUNTIME_FAIL] /analytics — page returns 404 despite route registered in router.tsx:18
- [RUNTIME_WARN] /settings — route renders but <UserPreferences /> missing from ARIA tree
```

Label these as `runtime-only` so developers know they won't be caught by future static checks alone.
