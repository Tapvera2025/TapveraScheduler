/**
 * Typed agent errors.
 *
 * Every tool failure must map to one of these codes. The planner is allowed to
 * see the code and message so it can ask a sensible follow-up question, but it
 * is never allowed to act on a failure by retrying with different scoping.
 */

const CODES = {
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  AMBIGUOUS_ENTITY: 'AMBIGUOUS_ENTITY',
  FORBIDDEN: 'FORBIDDEN',
  MODULE_DISABLED: 'MODULE_DISABLED',
  CONFLICT: 'CONFLICT',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  TIMEOUT: 'TIMEOUT',
  PLANNER_UNAVAILABLE: 'PLANNER_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
};

class AgentError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'AgentError';
    this.code = CODES[code] ? code : CODES.INTERNAL;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

const invalidInput = (message, details) => new AgentError(CODES.INVALID_INPUT, message, details);
const notFound = (message, details) => new AgentError(CODES.NOT_FOUND, message, details);
const ambiguous = (message, details) => new AgentError(CODES.AMBIGUOUS_ENTITY, message, details);
const forbidden = (message, details) => new AgentError(CODES.FORBIDDEN, message, details);
const moduleDisabled = (message, details) => new AgentError(CODES.MODULE_DISABLED, message, details);
const conflict = (message, details) => new AgentError(CODES.CONFLICT, message, details);
const plannerUnavailable = (message, details) => new AgentError(CODES.PLANNER_UNAVAILABLE, message, details);
const limitExceeded = (message, details) => new AgentError(CODES.LIMIT_EXCEEDED, message, details);

module.exports = {
  CODES,
  AgentError,
  invalidInput,
  notFound,
  ambiguous,
  forbidden,
  moduleDisabled,
  conflict,
  plannerUnavailable,
  limitExceeded,
};
