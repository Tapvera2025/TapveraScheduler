/**
 * The tool catalogue.
 *
 * This is the complete list of things the agent may do. Adding an entry here is
 * the only way to widen what it can reach, which makes the review question
 * "should this be on the list" rather than "what could it possibly call".
 *
 * Note what the schemas do NOT contain: companyId, userId, role, raw query
 * predicates, limits, or URLs. The planner cannot express those, so it cannot
 * ask for another tenant's data even if it is told to.
 */

const getAttendanceReport = require('./tools/getAttendanceReport');
const findEmployeeShifts = require('./tools/findEmployeeShifts');
const getDailySummary = require('./tools/getDailySummary');
const listEmployees = require('./tools/listEmployees');
const listSites = require('./tools/listSites');
const createShift = require('./tools/createShift');
const cancelShift = require('./tools/cancelShift');
const createEmployee = require('./tools/createEmployee');
const createClient = require('./tools/createClient');
const createSite = require('./tools/createSite');
const updateEmployee = require('./tools/updateEmployee');
const deactivateEmployee = require('./tools/deactivateEmployee');
const updateClient = require('./tools/updateClient');
const updateSite = require('./tools/updateSite');
const updateShift = require('./tools/updateShift');

const TOOLS = [
  // Reads — ordered by frequency of use
  getDailySummary,
  findEmployeeShifts,
  getAttendanceReport,
  listEmployees,
  listSites,
  // Writes
  createShift,
  cancelShift,
  createEmployee,
  createClient,
  createSite,
  updateEmployee,
  deactivateEmployee,
  updateClient,
  updateSite,
  updateShift,
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Fields the planner is never allowed to supply, whatever it says. */
const RESERVED_KEYS = [
  'companyId',
  'company',
  'userId',
  'actorId',
  'role',
  'roles',
  'tenant',
  'tenantId',
  'limit',
  'skip',
  'query',
  'filter',
  'projection',
  'pipeline',
  'url',
  'code',
];

/**
 * Fields a tool accepts from the app but never from the planner.
 *
 * Coordinates arrive from the map picker, where the admin has seen the pin.
 * A model asked where a place is will produce plausible numbers that are a few
 * hundred metres out, and a geofence drawn around the wrong point turns real
 * employees away at the real site. The gateway still accepts these fields;
 * only the planner's proposals are stripped of them.
 */
const PICKER_ONLY_KEYS = ['latitude', 'longitude'];

const getTool = (name) => BY_NAME.get(name) || null;

const listTools = () => TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  kind: t.kind,
  modules: t.modules,
  roles: t.roles,
}));

/**
 * Function definitions in the shape Grok and other OpenAI-compatible APIs
 * expect. Only tools the actor may actually run are advertised, so the planner
 * is not tempted by an operation that would be refused anyway.
 */
const toolSchemasFor = ({ role, enabledModules = [] }) =>
  TOOLS.filter((t) => t.roles.includes(role))
    .filter((t) => t.modules.every((m) => enabledModules.includes(m)))
    .map((t) => ({
      type: 'function',
      // `function` is the part sent verbatim to the planner. `kind` and
      // `required` sit outside it, for the UI: a write must be previewed and
      // confirmed, a read may run straight away.
      kind: t.kind,
      required: t.required || [],
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

module.exports = { TOOLS, RESERVED_KEYS, PICKER_ONLY_KEYS, getTool, listTools, toolSchemasFor };
