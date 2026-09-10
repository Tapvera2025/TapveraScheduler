/**
 * Public surface of the agent module.
 *
 * Everything outside src/agent/ should import from here. Nothing outside this
 * module should reach past the gateway into a tool handler directly, because
 * the handler alone performs no authorisation.
 */

const {
  actorFromRequest,
  execute,
  prepare,
  commit,
  cancelDraft,
  availableTools,
  SOURCE_VERSION,
} = require('./gateway');
const { plan } = require('./planner');
const { listTools } = require('./registry');
const { AgentError, CODES } = require('./errors');

module.exports = {
  actorFromRequest,
  plan,
  execute,
  prepare,
  commit,
  cancelDraft,
  availableTools,
  listTools,
  AgentError,
  CODES,
  SOURCE_VERSION,
};
