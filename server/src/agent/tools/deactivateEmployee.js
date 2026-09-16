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
