/**
 * deactivateEmployee — soft-delete an employee from the organisation.
 *
 * Cascade effects: all future SCHEDULED shifts are auto-cancelled and all
 * site assignments are deactivated. Past shifts are kept for payroll/audit.
 *
 * prepare counts upcoming shifts so the admin sees the blast radius before
 * confirming. commit re-reads the count via the service, which is authoritative.
 *
 * Roles: ADMIN only. Managers may not deactivate people; that decision requires
 * an admin. The service enforces no role check itself, so this tool is the gate.
 *
 * Edge case: if the employee is already soft-deleted, resolveEmployeeRef throws
 * NOT_FOUND (the softDelete plugin filters deletedAt: null). The "already
 * deactivated" case is intentionally surfaced as NOT_FOUND — attempting to
 * deactivate a deleted record is not a meaningful operation.
 */

const Shift = require('../../models/Shift');
const employeeService = require('../../services/employee.service');
const { resolveEmployeeRef } = require('../resolver');
const { invalidInput, notFound } = require('../errors');

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

  let result;
  try {
    result = await employeeService.deleteEmployee(
      { companyId: actor.companyId, userId: actor.userId, role: actor.role },
      employeeId
    );
  } catch (err) {
    if (err.statusCode === 404) throw notFound('That employee no longer exists', { entity: 'employee' });
    throw err;
  }

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
