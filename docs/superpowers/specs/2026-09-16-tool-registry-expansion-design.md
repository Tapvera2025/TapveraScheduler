# Tool Registry Expansion Design — Sub-project C

**Date:** 2026-09-16
**Status:** Approved
**Scope:** Add five update/delete write tools to the agent tool registry.

---

## Problem

The agent can create shifts, employees, clients, and sites, and cancel shifts. It cannot update or remove any entity, so all corrections require abandoning the voice/text conversation and using the UI.

---

## Decision

Add five write tools, all following the existing `build/prepare/commit` two-phase pattern.

| Tool | Service method | Identifies by |
|------|----------------|---------------|
| `updateEmployee` | `employeeService.updateEmployee` | `employeeId` or `employeeName` |
| `deactivateEmployee` | `employeeService.deleteEmployee` | `employeeId` or `employeeName` |
| `updateClient` | `clientService.updateClient` | `clientId` or `clientName` |
| `updateSite` | `sitesService.updateSite` | `siteId` or `siteName` |
| `updateShift` | `schedulerService.updateShift` | `shiftId` or (`employeeName`/`employeeId` + `date`) |

---

### updateEmployee

**Update fields:** `firstName`, `lastName`, `email`, `position`, `department`, `phone`  
At least one update field required. `build()` is shared by `prepare` and `commit` (re-validates on confirm).

- `prepare` resolves the employee via `resolveEmployeeRef`, validates email uniqueness if changing, returns a before/after `changes` list in the preview.
- If email changes and the employee has a linked login account, the service resets their password and sends credentials to the new address (handled by the service; noted in the preview).
- `draft.plan` stores `{ employeeId, updates }` (the resolved id and trimmed update map).
- `commit` calls `employeeService.updateEmployee(context, employeeId, updates)`.

---

### deactivateEmployee

No update fields — it is a soft delete with cascade effects.

- `prepare` resolves the employee, counts future SCHEDULED shifts via `Shift.countDocuments`, returns a preview with the cascade count.
- `draft.plan` stores `{ employeeId }`.
- `commit` calls `employeeService.deleteEmployee(context, employeeId)`.
- Role guard: ADMIN only (not MANAGER) — destructive cascade makes this a higher-privilege action.

---

### updateClient

**Update fields:** `newName` (rename), `state`  
At least one update field required.

- `prepare` resolves client by id (inline ObjectId guard) or by `resolveClient(actor, clientName)` from `../resolver`.
- `draft.plan` stores `{ clientId, updates }`.
- `commit` calls `clientService.updateClient(context, clientId, updates)`.

---

### updateSite

**Update fields:** `siteLocationName`, `shortName`, `timezone`  
At least one update field required.

- `prepare` resolves site by id (inline guard) or by `resolveSite(actor, siteName)` from `../resolver`.
- `draft.plan` stores `{ siteId, updates }`.
- `commit` calls `sitesService.updateSite(context, siteId, updates)`.

---

### updateShift

**Update fields:** `newDate` + `start` + `end` (must be supplied together if any time change), `shiftType`, `breakMinutes`  
At least one update field required. Employee and site reassignment are excluded — UI-only operations.

- Identification: `shiftId` first; if absent, `resolveEmployeeRef` + `date` (same pattern as `cancelShift`).
- When time fields are present: `shiftInstants()` derives new UTC instants; `findConflicts({ excludeShiftId })` checks for overlaps.
- `prepare` throws `CONFLICT` if any overlap found.
- `draft.plan` stores `{ shiftId, startTime, endTime, dateInstant }` as ISO strings (when time changes), plus `shiftType`, `breakDuration`.
- `commit` re-derives instants, drift-checks startTime/endTime against `draft.plan`, then calls `schedulerService.updateShift(context, shiftId, data)`.

---

## Out of scope

- Employee reassignment in `updateShift` (requires site-assignment validation — UI only)
- `deleteClient`, `deleteSite` (high blast radius — UI modal only)
- `restoreEmployee` (edge case — UI only)

---

## Files changed

| File | Change |
|------|--------|
| `server/src/agent/tools/updateEmployee.js` | New |
| `server/src/agent/tools/deactivateEmployee.js` | New |
| `server/src/agent/tools/updateClient.js` | New |
| `server/src/agent/tools/updateSite.js` | New |
| `server/src/agent/tools/updateShift.js` | New |
| `server/src/agent/registry.js` | Register all 5 new tools |
