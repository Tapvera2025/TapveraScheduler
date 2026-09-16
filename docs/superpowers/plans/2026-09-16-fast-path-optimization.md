# Fast-Path Optimization (Sub-project B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the intent router before entity resolution for entity-free patterns; add cancelShift and getAttendanceReport to the fast path.

**Architecture:** Two files only. `intentRouter.js` gains `routeEntityFree` (entity-free subset of patterns + new tool routes). `planner.js` calls `routeEntityFree` before the `Promise.all` and passes `Promise.resolve(text)` for preResolve when a match is found.

**Tech Stack:** Pure Node.js — no new deps, no new files.

---

## File map

| File | Change |
|------|--------|
| `server/src/agent/intentRouter.js` | Add `routeEntityFree`; expand routeRead + routeWrite |
| `server/src/agent/planner.js` | Conditional preResolve |

---

## Task 1: Expand intentRouter.js

**Files:**
- Modify: `server/src/agent/intentRouter.js`

### Background

Current exports: `{ route, routeRead, routeWrite, parseTimeRange }`

`routeRead` handles: `findEmployeeShifts`, `getDailySummary`, `listEmployees`  
`routeWrite` handles: `createShift` only

We are adding:
- `routeRead`: `getAttendanceReport` pattern (entity-dependent)
- `routeWrite`: `cancelShift` pattern (entity-dependent, destructive)
- New export `routeEntityFree`: entity-free subset (getDailySummary + listEmployees)

---

- [ ] **Step 1: Add CANCEL_SHIFT_VERB_RE constant**

After the existing `CREATE_SHIFT_VERB_RE` constant (around line 30), add:

```js
const CANCEL_SHIFT_VERB_RE = /\b(cancel|remove|delete)\s+(?:(?:the|a|this|that)\s+)?shift\b/i;
```

- [ ] **Step 2: Extend getDailySummary pattern in routeRead**

Find this line in `routeRead` (around line 123):

```js
  if (/who.{0,25}work|today.{0,20}roster|roster.{0,20}today|daily.{0,20}summ|show.{0,20}roster/i.test(lower)) {
```

Replace with:

```js
  if (/who.{0,25}work|today.{0,20}roster|roster.{0,20}today|daily.{0,20}summ|show.{0,20}roster|today.{0,20}(schedule|shifts?)|who.{0,15}on.{0,15}today|on\s+shift.{0,15}today|staff.{0,20}(schedule|roster).{0,15}today/i.test(lower)) {
```

- [ ] **Step 3: Add getAttendanceReport to routeRead**

After the `listEmployees` block (around line 133–137) and before `return null`, add:

```js
  // getAttendanceReport — "attendance for archi", "clock-in report for archi"
  if (ex.employeeId && /attendance|clock.{0,5}in|monthly.{0,10}report/i.test(lower)) {
    return { tool: 'getAttendanceReport', input: { employeeId: ex.employeeId } };
  }
```

- [ ] **Step 4: Add cancelShift to routeWrite**

At the top of `routeWrite` (before the `CREATE_SHIFT_VERB_RE` check), add:

```js
  if (CANCEL_SHIFT_VERB_RE.test(text)) {
    const ex = extract(text);
    // Require employeeId annotation from preResolve and a single resolved date.
    // A date range means "cancel this whole week" — fall through to LLM.
    if (!ex.employeeId || !ex.date || ex.from) return null;
    return { tool: 'cancelShift', input: { employeeId: ex.employeeId, date: ex.date } };
  }
```

- [ ] **Step 5: Add routeEntityFree function**

After `routeWrite` and before the `route` combiner, add:

```js
/**
 * Patterns that need no entity annotations (no employeeId, no siteId).
 * Called on raw text before preResolve so we can skip the DB call entirely.
 * Returns { tool, input } or null.
 */
const routeEntityFree = (text) => {
  if (WRITE_RE.test(text)) return null;
  const lower = text.toLowerCase();

  // getDailySummary — entity-free: any daily roster query without a named person
  if (/who.{0,25}work|today.{0,20}roster|roster.{0,20}today|daily.{0,20}summ|show.{0,20}roster|today.{0,20}(schedule|shifts?)|who.{0,15}on.{0,15}today|on\s+shift.{0,15}today|staff.{0,20}(schedule|roster).{0,15}today/i.test(lower)) {
    return { tool: 'getDailySummary', input: {} };
  }

  // listEmployees — entity-free: any list/show employees query
  if (/\b(list|show|get|view|all|how many).{0,20}(employees?|staff|workers?|team)\b|\bemployee\s+list\b/i.test(lower)) {
    return { tool: 'listEmployees', input: {} };
  }

  return null;
};
```

- [ ] **Step 6: Export routeEntityFree**

Find:

```js
module.exports = { route, routeRead, routeWrite, parseTimeRange };
```

Replace with:

```js
module.exports = { route, routeRead, routeWrite, routeEntityFree, parseTimeRange };
```

- [ ] **Step 7: Verify module loads**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
node -e "const r = require('./src/agent/intentRouter'); console.log(typeof r.routeEntityFree, typeof r.route);"
```

Expected: `function function`

- [ ] **Step 8: Spot-check key routes**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
node -e "
const { route, routeEntityFree } = require('./src/agent/intentRouter');

// Entity-free
console.log('EF listEmployees:', JSON.stringify(routeEntityFree('list employees')));
console.log('EF getDailySummary:', JSON.stringify(routeEntityFree('who is working today')));
console.log('EF write guard:', routeEntityFree('schedule archi for tomorrow 9am to 5pm'));
console.log('EF entity present (should be null):', routeEntityFree('find shifts for Archisman Dutta (employeeId: abc123abc123abc12)'));

// getAttendanceReport via full route
console.log('attendance:', JSON.stringify(route('attendance for Archisman Dutta (employeeId: aaaaaaaaaaaaaaaaaaaaaaaa)')));

// cancelShift via full route (needs date annotation from normalizer — use pre-normalised form)
console.log('cancelShift:', JSON.stringify(route('cancel shift for Archisman Dutta (employeeId: aaaaaaaaaaaaaaaaaaaaaaaa) on 2026-09-18')));

// date range must return null (fall to LLM)
console.log('cancelShift range (must be null):', route('cancel shift for Archisman Dutta (employeeId: aaaaaaaaaaaaaaaaaaaaaaaa) 2026-09-18 to 2026-09-21'));
"
```

Expected output:
```
EF listEmployees: {"tool":"listEmployees","input":{}}
EF getDailySummary: {"tool":"getDailySummary","input":{}}
EF write guard: null
EF entity present (should be null): null
attendance: {"tool":"getAttendanceReport","input":{"employeeId":"aaaaaaaaaaaaaaaaaaaaaaaa"}}
cancelShift: {"tool":"cancelShift","input":{"employeeId":"aaaaaaaaaaaaaaaaaaaaaaaa","date":"2026-09-18"}}
cancelShift range (must be null): null
```

- [ ] **Step 9: Commit**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git add server/src/agent/intentRouter.js
git commit -m "$(cat <<'EOF'
feat: expand intent router — add routeEntityFree, cancelShift, getAttendanceReport fast paths

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Conditional preResolve in planner.js

**Files:**
- Modify: `server/src/agent/planner.js`

### Background

`intentRouter` is already imported at line 29 of `planner.js`. The `Promise.all` on lines 167–171 always calls `preResolve`. We change it to skip `preResolve` when the raw text matches an entity-free pattern.

---

- [ ] **Step 1: Add the entity-free first-pass check**

Find this block in `plan()` (around lines 166–172):

```js
  const t0 = Date.now();
  const [tools, company, enrichedText] = await Promise.all([
    availableTools(actor),
    getCompanyProfile(actor.companyId),
    preResolve(actor, text),
  ]);
  const tResolved = Date.now();
```

Replace with:

```js
  const t0 = Date.now();
  // Skip preResolve for entity-free patterns — no DB call needed.
  const rawRoute = intentRouter.routeEntityFree(text);
  const [tools, company, enrichedText] = await Promise.all([
    availableTools(actor),
    getCompanyProfile(actor.companyId),
    rawRoute ? Promise.resolve(text) : preResolve(actor, text),
  ]);
  const tResolved = Date.now();
```

Do NOT change anything else in `plan()`. The `normalizeText` call, `intentRouter.route(normalizedText)` call, fast-path return, and LLM path are all unchanged.

- [ ] **Step 2: Verify module loads**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
node -e "require('./src/agent/planner'); console.log('planner loaded ok');"
```

Expected: `planner loaded ok`

- [ ] **Step 3: Verify no stale references**

```bash
grep -n "routeEntityFree" /Users/archismandutta/Desktop/roster/roster-mechanic/server/src/agent/planner.js
```

Expected: exactly one match (the `const rawRoute = intentRouter.routeEntityFree(text);` line).

- [ ] **Step 4: Commit**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git add server/src/agent/planner.js
git commit -m "$(cat <<'EOF'
perf: skip preResolve for entity-free intent patterns

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
