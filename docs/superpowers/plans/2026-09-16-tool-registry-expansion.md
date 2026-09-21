# Tool Registry Expansion (Sub-project C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five update/delete write tools to the agent registry — updateEmployee, deactivateEmployee, updateClient, updateSite, updateShift.

**Architecture:** Five new files under `server/src/agent/tools/`, all following the existing `build/prepare/commit` pattern from `createEmployee.js` and `cancelShift.js`. One registry.js modification to register them.

**Tech Stack:** Pure Node.js — no new deps, no new files beyond the six listed.

---

## File map

| File | Change |
|------|--------|
| `server/src/agent/tools/updateEmployee.js` | New |
| `server/src/agent/tools/deactivateEmployee.js` | New |
| `server/src/agent/tools/updateClient.js` | New |
| `server/src/agent/tools/updateSite.js` | New |
| `server/src/agent/tools/updateShift.js` | New |
| `server/src/agent/registry.js` | Add 5 new require + TOOLS entries |

---

## Task 1: updateEmployee.js

**Files:**
- Create: `server/src/agent/tools/updateEmployee.js`

### Background

`employeeService.updateEmployee(context, employeeId, data)` updates firstName, lastName, email, position, department, phone. It validates email uniqueness (excluding the current employee), handles email→login cascade. Context shape: `{ companyId, userId, role }`.

`resolveEmployeeRef(actor, { employeeId, employeeName })` is already exported from `../resolver` — use it for identification.

---

- [ ] **Step 1: Create the file**

`server/src/agent/tools/updateEmployee.js`:

```js
const employeeService = require('../../services/employee.service');
const Employee = require('../../models/Employee');
const { resolveEmployeeRef } = require('../resolver');
const { invalidInput, conflict } = require('../errors');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UPDATE_FIELDS = ['firstName', 'lastName', 'email', 'position', 'department', 'phone'];

const parameters = {
  type: 'object',
  properties: {
    employeeName: { type: 'string', description: 'Full name of the employee to update.' },
    employeeId: { type: 'string', description: 'Opaque employee id from an earlier tool call.' },
    firstName: { type: 'string', description: 'New given name.' },
    lastName: { type: 'string', description: 'New family name.' },
    email: { type: 'string', description: 'New work email address.' },
    position: { type: 'string', description: 'New job title.' },
    department: { type: 'string', description: 'New department or team.' },
    phone: { type: 'string', description: 'New contact number.' },
  },
  additionalProperties: false,
};

const build = async (actor, input) => {
  const employee = await resolveEmployeeRef(actor, input);

  const updates = {};
  for (const f of UPDATE_FIELDS) {
    if (input[f] !== undefined && input[f] !== null && input[f] !== '') {
      updates[f] = typeof input[f] === 'string' ? input[f].trim() : input[f];
    }
  }

  if (Object.keys(updates).length === 0) {
    throw invalidInput('What should be changed? Provide at least one field to update (name, email, position, department, or phone).');
  }

  if (updates.email) {
    updates.email = updates.email.toLowerCase();
    if (!EMAIL_PATTERN.test(updates.email)) {
      throw invalidInput(`"${input.email}" is not a valid email address`);
    }
    const existing = await Employee.findOne({
      email: updates.email,
      companyId: actor.companyId,
      _id: { $ne: employee.id },
    }).select('_id firstName lastName').lean();
    if (existing) {
      throw conflict(
        `${existing.firstName} ${existing.lastName} already uses ${updates.email} in your organisation`,
        { employeeId: existing._id.toString() }
      );
    }
  }

  return { employee, updates };
};

const prepare = async ({ actor, input }) => {
  const { employee, updates } = await build(actor, input);

  const notes = [];
  if (updates.email) {
    notes.push('If this employee has a login, their username and a new temporary password will be sent to the new address.');
  }

  return {
    plan: { employeeId: employee.id, updates },
    preview: {
      action: 'Update employee',
      employee: employee.name,
      changes: Object.entries(updates).map(([k, v]) => `${k}: ${v}`),
      notes,
    },
    resolvedEntities: { employee },
  };
};

const commit = async ({ actor, draft }) => {
  const { employee, updates } = await build(actor, draft.input);

  await employeeService.updateEmployee(
    { companyId: actor.companyId, userId: actor.userId, role: actor.role },
    employee.id,
    { ...updates }
  );

  return {
    data: { employeeId: employee.id, employee: employee.name, changes: Object.keys(updates) },
    summary: { updated: true, employeeId: employee.id, employee: employee.name },
  };
};

module.exports = {
  name: 'updateEmployee',
  description:
    "Update an employee's profile — change their name, job title, email, phone, or department. This CHANGES data and must be confirmed. Give the employee name or id and at least one field to update.",
  kind: 'write',
  modules: [],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 12000,
  required: [],
  parameters,
  prepare,
  commit,
};
```

- [ ] **Step 2: Verify module loads**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
node -e "const t = require('./src/agent/tools/updateEmployee'); console.log(t.name, t.kind, t.roles);"
```

Expected: `updateEmployee write [ 'ADMIN', 'MANAGER' ]`

- [ ] **Step 3: Commit**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git add server/src/agent/tools/updateEmployee.js
git commit -m "$(cat <<'EOF'
feat: add updateEmployee agent tool

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: deactivateEmployee.js

**Files:**
- Create: `server/src/agent/tools/deactivateEmployee.js`

### Background

`employeeService.deleteEmployee(context, employeeId)` soft-deletes the employee, auto-cancels future SCHEDULED shifts, deactivates site assignments. Returns `{ success, message, cancelledShifts }`.

`prepare` counts future shifts via `Shift.countDocuments` to give the admin a heads-up before they confirm.

Role is ADMIN only (not MANAGER) — destructive cascade.

---

- [ ] **Step 1: Create the file**

`server/src/agent/tools/deactivateEmployee.js`:

```js
const Shift = require('../../models/Shift');
const employeeService = require('../../services/employee.service');
const { resolveEmployeeRef } = require('../resolver');
const { invalidInput } = require('../errors');

const parameters = {
  type: 'object',
  properties: {
    employeeName: { type: 'string', description: 'Full name of the employee to deactivate.' },
    employeeId: { type: 'string', description: 'Opaque employee id from an earlier tool call.' },
  },
  additionalProperties: false,
};

const prepare = async ({ actor, input }) => {
  if (!input.employeeName && !input.employeeId) {
    throw invalidInput('Which employee should be deactivated? Give a name or id.');
  }

  const employee = await resolveEmployeeRef(actor, input);

  const futureShiftCount = await Shift.countDocuments({
    employeeId: employee.id,
    companyId: actor.companyId,
    status: 'SCHEDULED',
    startTime: { $gt: new Date() },
    deletedAt: null,
  });

  return {
    plan: { employeeId: employee.id },
    preview: {
      action: 'Deactivate employee',
      employee: employee.name,
      futureShiftsAffected: futureShiftCount,
      notes: [
        'The employee record will be soft-deleted and will no longer appear on rosters.',
        futureShiftCount > 0
          ? `${futureShiftCount} upcoming scheduled shift${futureShiftCount === 1 ? '' : 's'} will be cancelled.`
          : 'No upcoming scheduled shifts to cancel.',
        'All site assignments will be deactivated.',
        'Completed and past shifts are kept for payroll and audit records.',
      ],
    },
    resolvedEntities: { employee },
  };
};

const commit = async ({ actor, draft }) => {
  const { employeeId } = draft.plan;

  const result = await employeeService.deleteEmployee(
    { companyId: actor.companyId, userId: actor.userId, role: actor.role },
    employeeId
  );

  return {
    data: { employeeId, cancelledShifts: result.cancelledShifts },
    summary: { deactivated: true, employeeId, cancelledShifts: result.cancelledShifts },
  };
};

module.exports = {
  name: 'deactivateEmployee',
  description:
    'Remove an employee from the organisation. This CHANGES data, cascades to cancel their future shifts and deactivate site assignments, and must be confirmed. The record is soft-deleted and kept for payroll history.',
  kind: 'write',
  modules: [],
  roles: ['ADMIN'],
  timeoutMs: 12000,
  required: [],
  parameters,
  prepare,
  commit,
};
```

- [ ] **Step 2: Verify module loads**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
node -e "const t = require('./src/agent/tools/deactivateEmployee'); console.log(t.name, t.kind, t.roles);"
```

Expected: `deactivateEmployee write [ 'ADMIN' ]`

- [ ] **Step 3: Commit**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git add server/src/agent/tools/deactivateEmployee.js
git commit -m "$(cat <<'EOF'
feat: add deactivateEmployee agent tool

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: updateClient.js

**Files:**
- Create: `server/src/agent/tools/updateClient.js`

### Background

`clientService.updateClient(context, clientId, data)` updates clientName, state. It checks for duplicate clientName within the company. Context: `{ companyId, userId, role }`.

No `resolveClientRef` exists in `resolver.js`. The tool inlines the id lookup (guard + DB query) and falls back to `resolveClient(actor, clientName)` for name-based lookup.

The update parameter is `newName` (not `clientName`) to avoid collision with the identification parameter.

---

- [ ] **Step 1: Create the file**

`server/src/agent/tools/updateClient.js`:

```js
const mongoose = require('mongoose');
const Client = require('../../models/Client');
const clientService = require('../../services/client.service');
const { resolveClient } = require('../resolver');
const { invalidInput, notFound, conflict } = require('../errors');

const parameters = {
  type: 'object',
  properties: {
    clientName: { type: 'string', description: 'Current name of the client to update.' },
    clientId: { type: 'string', description: 'Opaque client id from an earlier tool call.' },
    newName: { type: 'string', description: 'New name for the client.' },
    state: { type: 'string', description: 'New state or territory where the client operates.' },
  },
  additionalProperties: false,
};

const resolveClientRef = async (actor, { clientId, clientName }) => {
  if (clientId) {
    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      throw invalidInput('That client reference is not valid');
    }
    const client = await Client.findOne({ _id: clientId, companyId: actor.companyId })
      .select('_id clientName')
      .lean();
    if (!client) throw notFound('That client is not in your organisation', { entity: 'client' });
    return { id: client._id.toString(), name: client.clientName };
  }
  if (clientName) return resolveClient(actor, clientName);
  throw invalidInput('Which client? Give a name or id.', { missing: ['clientName'] });
};

const build = async (actor, input) => {
  const client = await resolveClientRef(actor, input);

  const updates = {};
  if (input.newName !== undefined && input.newName !== null && input.newName.trim() !== '') {
    updates.clientName = input.newName.trim();
  }
  if (input.state !== undefined && input.state !== null && input.state.trim() !== '') {
    updates.state = input.state.trim();
  }

  if (Object.keys(updates).length === 0) {
    throw invalidInput('What should be changed? Provide a new name or state.');
  }

  if (updates.clientName) {
    const existing = await Client.findOne({
      clientName: updates.clientName,
      companyId: actor.companyId,
      _id: { $ne: client.id },
    }).select('_id').lean();
    if (existing) {
      throw conflict(`A client named "${updates.clientName}" already exists in your organisation`);
    }
  }

  return { client, updates };
};

const prepare = async ({ actor, input }) => {
  const { client, updates } = await build(actor, input);

  return {
    plan: { clientId: client.id, updates },
    preview: {
      action: 'Update client',
      client: client.name,
      changes: Object.entries(updates).map(([k, v]) => `${k}: ${v}`),
    },
    resolvedEntities: { client },
  };
};

const commit = async ({ actor, draft }) => {
  const { client, updates } = await build(actor, draft.input);

  await clientService.updateClient(
    { companyId: actor.companyId, userId: actor.userId, role: actor.role },
    client.id,
    { ...updates }
  );

  return {
    data: { clientId: client.id, client: updates.clientName || client.name, changes: Object.keys(updates) },
    summary: { updated: true, clientId: client.id, client: updates.clientName || client.name },
  };
};

module.exports = {
  name: 'updateClient',
  description:
    'Update a client — rename them or change their state. This CHANGES data and must be confirmed. Give the client name or id and at least one field to update.',
  kind: 'write',
  modules: [],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 10000,
  required: [],
  parameters,
  prepare,
  commit,
};
```

- [ ] **Step 2: Verify module loads**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
node -e "const t = require('./src/agent/tools/updateClient'); console.log(t.name, t.kind, t.roles);"
```

Expected: `updateClient write [ 'ADMIN', 'MANAGER' ]`

- [ ] **Step 3: Commit**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git add server/src/agent/tools/updateClient.js
git commit -m "$(cat <<'EOF'
feat: add updateClient agent tool

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: updateSite.js

**Files:**
- Create: `server/src/agent/tools/updateSite.js`

### Background

`sitesService.updateSite(context, siteId, data)` updates siteLocationName, shortName, timezone. It checks for duplicate shortName within the company. Context: `{ companyId, userId, role }`.

`resolveSite(actor, siteName)` from `../resolver` handles name-based lookup. For id-based, inline the guard + DB query (no `resolveSiteRef` exists).

---

- [ ] **Step 1: Create the file**

`server/src/agent/tools/updateSite.js`:

```js
const mongoose = require('mongoose');
const Site = require('../../models/Site');
const sitesService = require('../../services/sites.service');
const { resolveSite } = require('../resolver');
const { invalidInput, notFound, conflict } = require('../errors');

const parameters = {
  type: 'object',
  properties: {
    siteName: { type: 'string', description: 'Current name or short name of the site to update.' },
    siteId: { type: 'string', description: 'Opaque site id from an earlier tool call.' },
    siteLocationName: { type: 'string', description: 'New full name for the site.' },
    shortName: { type: 'string', description: 'New short identifier for the site.' },
    timezone: { type: 'string', description: 'New IANA timezone for the site, e.g. "Australia/Sydney".' },
  },
  additionalProperties: false,
};

const resolveSiteRef = async (actor, { siteId, siteName }) => {
  if (siteId) {
    if (!mongoose.Types.ObjectId.isValid(siteId)) {
      throw invalidInput('That site reference is not valid');
    }
    const site = await Site.findOne({ _id: siteId, companyId: actor.companyId })
      .select('_id siteLocationName shortName timezone')
      .lean();
    if (!site) throw notFound('That site is not in your organisation', { entity: 'site' });
    return { id: site._id.toString(), name: site.siteLocationName, shortName: site.shortName, timezone: site.timezone };
  }
  if (siteName) {
    const resolved = await resolveSite(actor, siteName);
    return resolved;
  }
  throw invalidInput('Which site? Give a name or id.', { missing: ['siteName'] });
};

const build = async (actor, input) => {
  const site = await resolveSiteRef(actor, input);

  const updates = {};
  if (input.siteLocationName?.trim()) updates.siteLocationName = input.siteLocationName.trim();
  if (input.shortName?.trim()) updates.shortName = input.shortName.trim();
  if (input.timezone?.trim()) updates.timezone = input.timezone.trim();

  if (Object.keys(updates).length === 0) {
    throw invalidInput('What should be changed? Provide a new name, short name, or timezone.');
  }

  if (updates.shortName) {
    const existing = await Site.findOne({
      shortName: updates.shortName,
      companyId: actor.companyId,
      _id: { $ne: site.id },
    }).select('_id').lean();
    if (existing) {
      throw conflict(`A site with short name "${updates.shortName}" already exists in your organisation`);
    }
  }

  return { site, updates };
};

const prepare = async ({ actor, input }) => {
  const { site, updates } = await build(actor, input);

  return {
    plan: { siteId: site.id, updates },
    preview: {
      action: 'Update site',
      site: site.name,
      changes: Object.entries(updates).map(([k, v]) => `${k}: ${v}`),
    },
    resolvedEntities: { site: { id: site.id, name: site.name } },
  };
};

const commit = async ({ actor, draft }) => {
  const { site, updates } = await build(actor, draft.input);

  await sitesService.updateSite(
    { companyId: actor.companyId, userId: actor.userId, role: actor.role },
    site.id,
    { ...updates }
  );

  return {
    data: { siteId: site.id, site: updates.siteLocationName || site.name, changes: Object.keys(updates) },
    summary: { updated: true, siteId: site.id, site: updates.siteLocationName || site.name },
  };
};

module.exports = {
  name: 'updateSite',
  description:
    'Update a site — rename it, change its short name, or update its timezone. This CHANGES data and must be confirmed. Give the site name or id and at least one field to update.',
  kind: 'write',
  modules: [],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 10000,
  required: [],
  parameters,
  prepare,
  commit,
};
```

- [ ] **Step 2: Verify module loads**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
node -e "const t = require('./src/agent/tools/updateSite'); console.log(t.name, t.kind, t.roles);"
```

Expected: `updateSite write [ 'ADMIN', 'MANAGER' ]`

- [ ] **Step 3: Commit**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git add server/src/agent/tools/updateSite.js
git commit -m "$(cat <<'EOF'
feat: add updateSite agent tool

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: updateShift.js

**Files:**
- Create: `server/src/agent/tools/updateShift.js`

### Background

`schedulerService.updateShift(context, shiftId, data)` accepts `{ date, startTime, endTime, shiftType, breakDuration }` as Date objects and raw strings respectively. It validates employee-site assignment and runs conflict detection internally.

Shift identification uses the same pattern as `cancelShift.js`: `shiftId` first, else `resolveEmployeeRef` + `date`.

For time changes, `shiftInstants({ date, start, end, timezone })` from `../scheduling` derives UTC instants. The timezone comes from the resolved shift's `siteId.timezone`.

`findConflicts({ companyId, employeeId, startTime, endTime, excludeShiftId })` — note the `excludeShiftId` parameter to skip the current shift in the overlap query.

`draft.plan` stores resolved ISO strings so `commit` can drift-check the times.

---

- [ ] **Step 1: Create the file**

`server/src/agent/tools/updateShift.js`:

```js
const mongoose = require('mongoose');
const Shift = require('../../models/Shift');
const schedulerService = require('../../services/scheduler.service');
const { resolveEmployeeRef } = require('../resolver');
const { getCompanyProfile } = require('../tenant');
const { shiftInstants, findConflicts } = require('../scheduling');
const { inZone } = require('../time');
const { invalidInput, notFound, conflict } = require('../errors');

const SHIFT_TYPES = ['REGULAR', 'OVERTIME', 'ON_CALL', 'NIGHT'];

const parameters = {
  type: 'object',
  properties: {
    shiftId: { type: 'string', description: 'Opaque shift id from a previous findEmployeeShifts or getDailySummary result.' },
    employeeName: { type: 'string', description: 'Employee whose shift to update.' },
    employeeId: { type: 'string', description: 'Opaque employee id from an earlier tool call.' },
    date: { type: 'string', description: 'Civil date of the shift to update, YYYY-MM-DD.' },
    newDate: { type: 'string', description: 'New civil date for the shift, YYYY-MM-DD. Must be supplied together with start and end.' },
    start: { type: 'string', description: 'New start time, HH:mm 24h. Must be supplied together with newDate and end.' },
    end: { type: 'string', description: 'New end time, HH:mm 24h. Must be supplied together with newDate and start.' },
    shiftType: { type: 'string', description: 'New shift type: REGULAR, OVERTIME, ON_CALL, or NIGHT.' },
    breakMinutes: { type: 'string', description: 'New unpaid break in minutes, as digits.' },
  },
  additionalProperties: false,
};

const fetchShiftById = async (actor, shiftId) => {
  if (!mongoose.Types.ObjectId.isValid(shiftId)) throw invalidInput('That shift reference is not valid');
  const shift = await Shift.findOne({ _id: shiftId, companyId: actor.companyId })
    .populate('employeeId', 'firstName lastName')
    .populate('siteId', 'siteLocationName timezone')
    .lean();
  if (!shift) throw notFound('That shift was not found in your organisation');
  return shift;
};

const fetchShiftByEmployeeDate = async (actor, input) => {
  const employee = await resolveEmployeeRef(actor, input);
  if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw invalidInput('Which date is the shift on?', { missing: ['date'] });
  }
  const { timezone } = await getCompanyProfile(actor.companyId);
  const { DateTime } = require('luxon');
  const dayStart = DateTime.fromFormat(input.date, 'yyyy-MM-dd', { zone: timezone }).startOf('day');
  const dayEnd = dayStart.plus({ days: 1 });

  const shifts = await Shift.find({
    companyId: actor.companyId,
    employeeId: employee.id,
    status: { $nin: ['CANCELLED'] },
    startTime: { $gte: dayStart.toUTC().toJSDate(), $lt: dayEnd.toUTC().toJSDate() },
  }).populate('siteId', 'siteLocationName timezone').lean();

  if (shifts.length === 0) throw notFound(`No active shift found for ${employee.name} on ${input.date}`);
  if (shifts.length > 1) {
    const zone = timezone;
    throw conflict(
      `${employee.name} has ${shifts.length} shifts on ${input.date}. Use a shiftId to specify which one.`,
      { conflicts: shifts.map((s) => ({ shiftId: s._id.toString(), site: s.siteId?.siteLocationName || null, start: inZone(s.startTime, s.siteId?.timezone || zone), end: inZone(s.endTime, s.siteId?.timezone || zone) })) }
    );
  }
  return shifts[0];
};

const resolveShift = (actor, input) =>
  input.shiftId ? fetchShiftById(actor, input.shiftId) : fetchShiftByEmployeeDate(actor, input);

const build = async (actor, input) => {
  if (!input.shiftId && !input.employeeName && !input.employeeId) {
    throw invalidInput('Which shift should be updated? Give a shift id, or an employee name and date.');
  }

  const shift = await resolveShift(actor, input);

  if (shift.status === 'CANCELLED') throw invalidInput('This shift is already cancelled and cannot be updated.');

  const hasTime = Boolean(input.newDate || input.start || input.end);
  if (hasTime && !(input.newDate && input.start && input.end)) {
    throw invalidInput('To reschedule a shift, provide a new date, a start time, and an end time together.');
  }

  const updates = {};
  let instants = null;

  if (hasTime) {
    const zone = shift.siteId?.timezone || (await getCompanyProfile(actor.companyId)).timezone;
    instants = shiftInstants({ date: input.newDate, start: input.start, end: input.end, timezone: zone });
    updates.date = instants.dateInstant;
    updates.startTime = instants.startTime;
    updates.endTime = instants.endTime;
  }

  if (input.shiftType) {
    const st = input.shiftType.toUpperCase();
    if (!SHIFT_TYPES.includes(st)) throw invalidInput(`Shift type must be one of ${SHIFT_TYPES.join(', ')}`);
    updates.shiftType = st;
  }

  if (input.breakMinutes !== undefined && input.breakMinutes !== null) {
    if (!/^\d{1,3}$/.test(String(input.breakMinutes))) throw invalidInput('Break minutes must be a whole number');
    updates.breakDuration = Number(input.breakMinutes);
  }

  if (Object.keys(updates).length === 0) {
    throw invalidInput('What should be changed? Provide a new date/time, shift type, or break duration.');
  }

  if (instants) {
    const employeeId = shift.employeeId?._id?.toString() || shift.employeeId?.toString();
    const conflicts = await findConflicts({
      companyId: actor.companyId,
      employeeId,
      startTime: instants.startTime,
      endTime: instants.endTime,
      excludeShiftId: shift._id.toString(),
    });
    if (conflicts.length) {
      throw conflict('The employee already has a shift overlapping the new time', { conflicts });
    }
  }

  return { shift, updates, instants };
};

const prepare = async ({ actor, input }) => {
  const { shift, updates, instants } = await build(actor, input);
  const zone = shift.siteId?.timezone || (await getCompanyProfile(actor.companyId)).timezone;
  const shiftId = shift._id.toString();
  const employeeName =
    shift.employeeId
      ? `${shift.employeeId.firstName} ${shift.employeeId.lastName}`
      : 'Open shift';

  const plan = {
    shiftId,
    ...(instants ? { startTime: instants.startTime.toISOString(), endTime: instants.endTime.toISOString(), dateInstant: instants.dateInstant.toISOString() } : {}),
    ...(updates.shiftType ? { shiftType: updates.shiftType } : {}),
    ...(updates.breakDuration !== undefined ? { breakDuration: updates.breakDuration } : {}),
  };

  return {
    plan,
    preview: {
      action: 'Update shift',
      employee: employeeName,
      site: shift.siteId?.siteLocationName || '—',
      currentStart: inZone(shift.startTime, zone),
      currentEnd: inZone(shift.endTime, zone),
      changes: [
        ...(instants ? [`reschedule to ${instants.localStart} – ${instants.localEnd}`] : []),
        ...(updates.shiftType ? [`shiftType: ${updates.shiftType}`] : []),
        ...(updates.breakDuration !== undefined ? [`break: ${updates.breakDuration} min`] : []),
      ],
    },
    resolvedEntities: { shift: { id: shiftId } },
  };
};

const commit = async ({ actor, draft }) => {
  const { shift, updates, instants } = await build(actor, draft.input);
  const shiftId = shift._id.toString();

  if (instants) {
    const approvedStart = draft.plan.startTime;
    const approvedEnd = draft.plan.endTime;
    if (instants.startTime.toISOString() !== approvedStart || instants.endTime.toISOString() !== approvedEnd) {
      throw conflict('The shift times changed since it was previewed. Please review it again.');
    }
  }

  await schedulerService.updateShift(
    { companyId: actor.companyId, userId: actor.userId, role: actor.role },
    shiftId,
    updates
  );

  return {
    data: { shiftId, changes: Object.keys(draft.plan).filter((k) => k !== 'shiftId') },
    summary: { updated: true, shiftId },
  };
};

module.exports = {
  name: 'updateShift',
  description:
    'Update a shift — reschedule it to a new date and time, change its type, or adjust the break. This CHANGES data and must be confirmed. Identify the shift by id, or by employee name and date.',
  kind: 'write',
  modules: ['scheduler'],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 12000,
  required: [],
  parameters,
  prepare,
  commit,
};
```

- [ ] **Step 2: Verify module loads**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
node -e "const t = require('./src/agent/tools/updateShift'); console.log(t.name, t.kind, t.roles);"
```

Expected: `updateShift write [ 'ADMIN', 'MANAGER' ]`

- [ ] **Step 3: Commit**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git add server/src/agent/tools/updateShift.js
git commit -m "$(cat <<'EOF'
feat: add updateShift agent tool

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Register all tools in registry.js

**Files:**
- Modify: `server/src/agent/registry.js`

### Background

Current registry exports five write tools: createShift, cancelShift, createEmployee, createClient, createSite.

Add five new requires and insert into the TOOLS array after `createSite`.

---

- [ ] **Step 1: Add requires**

Find these lines near the top of `server/src/agent/registry.js`:

```js
const createEmployee = require('./tools/createEmployee');
const createClient = require('./tools/createClient');
const createSite = require('./tools/createSite');
```

Replace with:

```js
const createEmployee = require('./tools/createEmployee');
const createClient = require('./tools/createClient');
const createSite = require('./tools/createSite');
const updateEmployee = require('./tools/updateEmployee');
const deactivateEmployee = require('./tools/deactivateEmployee');
const updateClient = require('./tools/updateClient');
const updateSite = require('./tools/updateSite');
const updateShift = require('./tools/updateShift');
```

- [ ] **Step 2: Add to TOOLS array**

Find:

```js
  createEmployee,
  createClient,
  createSite,
];
```

Replace with:

```js
  createEmployee,
  createClient,
  createSite,
  updateEmployee,
  deactivateEmployee,
  updateClient,
  updateSite,
  updateShift,
];
```

- [ ] **Step 3: Verify registry loads and counts tools**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
node -e "
const { TOOLS, toolSchemasFor } = require('./src/agent/registry');
console.log('total tools:', TOOLS.length);
const schemas = toolSchemasFor({ role: 'ADMIN', enabledModules: ['scheduler'] });
console.log('ADMIN+scheduler tool names:', schemas.map(s => s.function.name).join(', '));
"
```

Expected output:
```
total tools: 14
ADMIN+scheduler tool names: getDailySummary, findEmployeeShifts, getAttendanceReport, listEmployees, createShift, cancelShift, createEmployee, createClient, createSite, updateEmployee, deactivateEmployee, updateClient, updateSite, updateShift
```

- [ ] **Step 4: Commit**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git add server/src/agent/registry.js
git commit -m "$(cat <<'EOF'
feat: register updateEmployee, deactivateEmployee, updateClient, updateSite, updateShift in agent registry

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
