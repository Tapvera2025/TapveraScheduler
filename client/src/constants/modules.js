/**
 * Module keys, mirroring server/src/config/modules.js
 *
 * These decide which navigation items and routes an organisation sees. The
 * server is the authority — this is only here so the UI can hide what the API
 * would refuse anyway.
 */

export const MODULES = {
  CLIENTS: "clients",
  SITES: "sites",
  SCHEDULER: "scheduler",
  ADHOC: "adhoc",
  ATTENDANCE: "attendance",
  LEAVE: "leave",
  PORTAL: "portal",
};

export const MODULE_LABELS = {
  [MODULES.CLIENTS]: "Clients",
  [MODULES.SITES]: "Sites & Access Codes",
  [MODULES.SCHEDULER]: "Scheduler",
  [MODULES.ADHOC]: "Adhoc Shifts",
  [MODULES.ATTENDANCE]: "Attendance",
  [MODULES.LEAVE]: "Leave Management",
  [MODULES.PORTAL]: "Employee Portal",
};

export const ALL_MODULES = Object.values(MODULES);
