/**
 * Module Registry
 *
 * The single source of truth for which modules exist, what they are called and
 * what they depend on. Modules are the units the master admin switches on or
 * off per organisation.
 *
 * Core features (authentication, users, employees, dashboard, notifications and
 * a user's own profile) are always available and deliberately not listed here.
 *
 * Adding a module:
 *   1. add an entry below
 *   2. guard its routes with requireModule('<key>')
 *   3. gate its screens on the client with <ModuleRoute module="<key>">
 */

const MODULES = {
  clients: {
    key: 'clients',
    label: 'Clients',
    description: 'The organisation\'s own customers and their invoicing details.',
    dependsOn: [],
  },
  sites: {
    key: 'sites',
    label: 'Sites & Access Codes',
    description: 'Work sites, geofences, access codes and employee-to-site assignment.',
    dependsOn: ['clients'],
  },
  scheduler: {
    key: 'scheduler',
    label: 'Scheduler',
    description: 'Building and publishing the roster of shifts.',
    dependsOn: ['sites'],
  },
  adhoc: {
    key: 'adhoc',
    label: 'Adhoc Shifts',
    description: 'Unplanned shifts, including employee requests and approvals.',
    dependsOn: ['scheduler'],
  },
  attendance: {
    key: 'attendance',
    label: 'Attendance',
    description: 'Geofenced clock in/out, time records and timesheet export.',
    dependsOn: ['sites'],
  },
  leave: {
    key: 'leave',
    label: 'Leave Management',
    description: 'Leave requests, approvals and balances.',
    dependsOn: [],
  },
  portal: {
    key: 'portal',
    label: 'Employee Portal',
    description: 'The employee self-service area.',
    dependsOn: [],
  },
};

const MODULE_KEYS = Object.keys(MODULES);

// What a brand new organisation gets unless the master admin says otherwise
const DEFAULT_MODULES = [...MODULE_KEYS];

/**
 * Is this a module key we know about?
 */
const isValidModule = (key) => Object.prototype.hasOwnProperty.call(MODULES, key);

/**
 * Strip anything unrecognised and remove duplicates, keeping registry order.
 */
const normaliseModules = (keys = []) => {
  const wanted = new Set((Array.isArray(keys) ? keys : []).filter(isValidModule));
  return MODULE_KEYS.filter((key) => wanted.has(key));
};

/**
 * Expand a selection to include everything it depends on.
 * e.g. ['scheduler'] -> ['clients', 'sites', 'scheduler']
 */
const withDependencies = (keys = []) => {
  const resolved = new Set();

  const visit = (key) => {
    if (!isValidModule(key) || resolved.has(key)) return;
    resolved.add(key);
    MODULES[key].dependsOn.forEach(visit);
  };

  normaliseModules(keys).forEach(visit);

  return MODULE_KEYS.filter((key) => resolved.has(key));
};

/**
 * Check a selection is self-consistent, without changing it.
 * Returns { valid, unknown, missing } so a caller can explain the problem.
 */
const validateModules = (keys = []) => {
  const list = Array.isArray(keys) ? keys : [];
  const unknown = list.filter((key) => !isValidModule(key));
  const selected = new Set(normaliseModules(list));

  const missing = [];
  selected.forEach((key) => {
    MODULES[key].dependsOn.forEach((dependency) => {
      if (!selected.has(dependency) && !missing.includes(dependency)) {
        missing.push(dependency);
      }
    });
  });

  return {
    valid: unknown.length === 0 && missing.length === 0,
    unknown,
    missing,
  };
};

/**
 * Which enabled modules would break if this one were switched off.
 */
const dependentsOf = (key) =>
  MODULE_KEYS.filter((candidate) => MODULES[candidate].dependsOn.includes(key));

module.exports = {
  MODULES,
  MODULE_KEYS,
  DEFAULT_MODULES,
  isValidModule,
  normaliseModules,
  withDependencies,
  validateModules,
  dependentsOf,
};
