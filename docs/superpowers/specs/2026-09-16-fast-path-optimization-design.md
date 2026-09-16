# Fast-Path Optimization Design — Sub-project B

**Date:** 2026-09-16  
**Status:** Approved  
**Scope:** Move intent router before preResolve for entity-free patterns; expand router coverage to cancelShift and getAttendanceReport.

---

## Problem

The current `plan()` pipeline always runs `preResolve` (a DB-backed entity annotator) before the intent router gets a chance to short-circuit. For commands that require no entity annotations — "list employees", "who is working today" — this makes an unnecessary database call on every cache miss (every 60 s per company).

Current pipeline order:
```
Promise.all([availableTools, getCompanyProfile, preResolve])  ← preResolve always runs
→ normalizeText
→ intentRouter.route                                          ← router runs last
```

Target pipeline order:
```
intentRouter.routeEntityFree(rawText)                         ← new: router runs first
→ if entity-free match: Promise.all([availableTools, getCompanyProfile])  ← preResolve skipped
→ if no match:          Promise.all([availableTools, getCompanyProfile, preResolve])
→ normalizeText
→ intentRouter.route                                          ← existing full router unchanged
```

Additionally, three tool patterns are commonly typed or spoken but not covered by the router, forcing an unnecessary LLM call:
- `getAttendanceReport` — "attendance for archi" (entity-dependent)
- `cancelShift` — "cancel shift for archi on 2026-09-18" (entity-dependent, write)
- Richer `getDailySummary` and `listEmployees` aliases

---

## Decision

### Change 1 — `intentRouter.js`: add `routeEntityFree` and expand coverage

`routeEntityFree(text)` covers patterns that need no entity IDs and can therefore run on raw un-annotated text. Returns `{ tool, input }` or `null`. Only guards against write verbs (WRITE_RE).

**Entity-free patterns (new function):**

| Tool | New triggers added |
|------|--------------------|
| `getDailySummary` | "today's schedule", "today's shifts", "who's on today", "on shift today", "staff schedule today" |
| `listEmployees` | "employee list" (supplement to existing `list|show|get|view` pattern) |

**Entity-dependent patterns (extend existing `routeRead` / `routeWrite`):**

| Tool | Pattern | Input |
|------|---------|-------|
| `getAttendanceReport` | `attendance\|clock.{0,5}in\|monthly.{0,10}report` + employeeId in text | `{ employeeId }` |
| `cancelShift` | `cancel\|remove\|delete` + `shift` + employeeId + single date | `{ employeeId, date }` |

`cancelShift` goes in `routeWrite` (it is a destructive write). It requires **both** employeeId annotation (from preResolve) and a single ISO date (from normalizer); a date range is rejected (falls through to LLM). `CREATE_SHIFT_VERB_RE` is unchanged. A new `CANCEL_SHIFT_VERB_RE` guards the cancel branch.

`getAttendanceReport` goes in `routeRead`. No month extraction — the tool defaults to the current month when `month` is omitted.

**Export shape — no breaking change:**
```js
module.exports = { route, routeRead, routeWrite, routeEntityFree, parseTimeRange };
```

---

### Change 2 — `planner.js`: conditional preResolve

```js
// Entity-free first pass: if matched, skip preResolve entirely.
const rawRoute = intentRouter.routeEntityFree(text);

const [tools, company, enrichedText] = await Promise.all([
  availableTools(actor),
  getCompanyProfile(actor.companyId),
  rawRoute ? Promise.resolve(text) : preResolve(actor, text),
]);
```

`normalizeText` and `intentRouter.route` still run on `enrichedText` as before — for entity-free paths this is a no-op for text but correctly resolves any date expressions (e.g. "today" → ISO date). The pipeline timing fields are unchanged; `path: 'fast'` already distinguishes fast from LLM paths.

---

## Scope boundary — unchanged

- `preResolver.js`, `normalizer.js`, `gateway.js`, `resolver.js`, `drafts.js`
- All tools under `agent/tools/`
- All frontend files
- The prepare → confirm → commit flow
- `agent.routes.js`, `index.js`, `config/index.js`

---

## Files changed

| File | Nature of change |
|------|-----------------|
| `server/src/agent/intentRouter.js` | Add `routeEntityFree`; extend `routeRead` with `getAttendanceReport`; extend `routeWrite` with `cancelShift`; richer aliases for getDailySummary and listEmployees |
| `server/src/agent/planner.js` | One-line conditional: skip `preResolve` when `routeEntityFree` matches |

---

## Verification checklist

1. `routeEntityFree('list employees')` returns `{ tool: 'listEmployees', input: {} }`
2. `routeEntityFree('who is working today')` returns `{ tool: 'getDailySummary', input: {} }`
3. `routeEntityFree('schedule archi for tomorrow 9am to 5pm')` returns `null` (write verb present)
4. `routeEntityFree('find shifts for Archisman Dutta (employeeId: abc123)')` returns `null` (needs entity path)
5. `route('attendance for Archisman Dutta (employeeId: abc123)')` returns `{ tool: 'getAttendanceReport', input: { employeeId: 'abc123' } }`
6. `route('cancel shift for Archisman Dutta (employeeId: abc123) on 2026-09-18')` returns `{ tool: 'cancelShift', input: { employeeId: 'abc123', date: '2026-09-18' } }`
7. `route('cancel shift for Archisman Dutta (employeeId: abc123) 2026-09-18 to 2026-09-21')` returns `null` (date range rejected)
8. `plan()` does not call `preResolve` when the input matches an entity-free pattern (verify via timing: `resolveMs` drops to ~0 for these paths)
9. No reference to `routeEntityFree` outside `intentRouter.js` and `planner.js`
10. `node -e "require('./src/agent/intentRouter')"` loads without error
11. `node -e "require('./src/agent/planner')"` loads without error
