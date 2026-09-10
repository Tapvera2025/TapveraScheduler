/**
 * The agent gateway.
 *
 * Single entry point for every business action the agent can take, whether the
 * request arrived as typed text or as a function call from a voice model. The
 * planner proposes; this decides.
 *
 * Reads go straight through `execute`. Writes are always two calls:
 *
 *   prepare -> a durable draft with a preview and an integrity hash
 *   commit  -> revalidate, claim the draft atomically, then act
 *
 * No database transaction is ever held open while a person reads a preview.
 * The draft carries the intent; the commit re-derives the world and refuses if
 * it has moved.
 *
 * The actor is built from the authenticated request only. Nothing the model
 * says can widen it.
 */

const { randomUUID } = require('crypto');
const AgentCommand = require('../models/AgentCommand');
const logger = require('../utils/logger');
const { getEnabledModules } = require('../middleware/moduleAccess');
const { getTool, RESERVED_KEYS, toolSchemasFor } = require('./registry');
const drafts = require('./drafts');
const {
  AgentError,
  CODES,
  invalidInput,
  forbidden,
  notFound,
  moduleDisabled,
} = require('./errors');

const MAX_STRING_LENGTH = 200;
const SOURCE_VERSION = 'agent-gateway/1.1.0';

/**
 * Build the actor from an authenticated request. This is the only supported
 * way to obtain one.
 */
const actorFromRequest = (req) => {
  const { userId, companyId, role } = req.user || {};

  if (!userId || !role) throw forbidden('This action requires a signed-in user');

  // Platform masters administer organisations; they do not act inside one.
  if (role === 'MASTER') {
    throw forbidden('Platform administrators cannot run organisation operations');
  }

  if (!companyId) throw forbidden('This account is not linked to an organisation');

  return { userId: String(userId), companyId: String(companyId), role };
};

/**
 * Accept only the keys the tool declares, only as strings, only within a sane
 * length. Anything else is dropped loudly rather than passed through.
 */
const sanitiseInput = (tool, raw) => {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const allowed = Object.keys(tool.parameters?.properties || {});
  const clean = {};
  const rejected = [];

  Object.entries(input).forEach(([key, value]) => {
    if (RESERVED_KEYS.includes(key) || !allowed.includes(key)) {
      rejected.push(key);
      return;
    }
    if (value === null || value === undefined || value === '') return;
    if (typeof value !== 'string') throw invalidInput(`"${key}" must be text`);

    const trimmed = value.trim();
    if (trimmed.length > MAX_STRING_LENGTH) throw invalidInput(`"${key}" is too long`);
    clean[key] = trimmed;
  });

  if (rejected.length) {
    logger.warn('Agent tool call carried fields it may not set', { tool: tool.name, rejected });
  }

  return clean;
};

/** Tool exists, actor may run it, its modules are on. Shared by all phases. */
const guard = async (actor, toolName, input, expectedKind) => {
  const tool = getTool(toolName);
  if (!tool) throw notFound(`No such operation: ${toolName}`);

  if (expectedKind && tool.kind !== expectedKind) {
    throw invalidInput(
      tool.kind === 'write'
        ? `${tool.name} changes data and must be previewed before it runs`
        : `${tool.name} is read-only and does not need confirming`
    );
  }

  const clean = sanitiseInput(tool, input);

  if (!tool.roles.includes(actor.role)) throw forbidden('Your role cannot run this operation');

  if (tool.modules.length) {
    const enabled = await getEnabledModules(actor.companyId);
    const missing = tool.modules.filter((m) => !enabled.includes(m));
    if (missing.length) {
      throw moduleDisabled(`${missing[0]} is not enabled for your organisation`, {
        modules: missing,
      });
    }
  }

  return { tool, clean };
};

const withTimeout = (promise, ms, toolName) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new AgentError(CODES.TIMEOUT, `${toolName} took too long and was stopped`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const recordCommand = async (entry) => {
  try {
    await AgentCommand.create(entry);
  } catch (error) {
    // A failure to audit must never mask the real outcome, but it is itself
    // important, so it is logged loudly.
    logger.error('Agent command could not be written to the ledger', {
      correlationId: entry.correlationId,
      tool: entry.tool,
      error: error.message,
    });
  }
};

/**
 * Runs one phase, audits it whatever happens, and returns a typed envelope.
 * `run` returns { data, summary, resolvedEntities }.
 */
const runPhase = async ({ actor, toolName, phase, kind, inputRef, channel, draftId, run }) => {
  const correlationId = randomUUID();
  const startedAt = new Date();

  const settleAudit = async (outcome, { summary, resolvedEntities, error }) => {
    const finishedAt = new Date();
    await recordCommand({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      correlationId,
      channel,
      tool: toolName,
      kind,
      phase,
      draftId: draftId || null,
      input: (inputRef && inputRef.accepted) || {},
      resolvedEntities: resolvedEntities || {},
      outcome,
      errorCode: error?.code || null,
      errorMessage: error?.message || null,
      resultSummary: summary || null,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      sourceVersion: SOURCE_VERSION,
    });
  };

  try {
    const result = await run(correlationId);
    await settleAudit('SUCCEEDED', {
      summary: result.summary,
      resolvedEntities: result.resolvedEntities,
    });
    return { ok: true, tool: toolName, phase, correlationId, ...result.envelope };
  } catch (error) {
    const agentError =
      error instanceof AgentError
        ? error
        : new AgentError(CODES.INTERNAL, 'That operation could not be completed');

    if (!(error instanceof AgentError)) {
      logger.error('Agent tool threw an unexpected error', {
        correlationId,
        tool: toolName,
        phase,
        error: error.message,
        stack: error.stack,
      });
    }

    const denied = [CODES.FORBIDDEN, CODES.MODULE_DISABLED].includes(agentError.code);
    await settleAudit(denied ? 'DENIED' : 'FAILED', { error: agentError });

    return { ok: false, tool: toolName, phase, correlationId, error: agentError.toJSON() };
  }
};

/** Run a read-only operation. */
const execute = async ({ actor, toolName, input = {}, channel = 'text' }) => {
  const inputRef = { accepted: {} };
  return runPhase({
    actor,
    toolName,
    phase: 'execute',
    kind: getTool(toolName)?.kind || 'read',
    channel,
    inputRef,
    run: async () => {
      const guarded = await guard(actor, toolName, input, 'read');
      const clean = guarded.clean;
      inputRef.accepted = clean;
      const result = await withTimeout(
        guarded.tool.handler({ actor, input: clean }),
        guarded.tool.timeoutMs || 10000,
        guarded.tool.name
      );
      return {
        summary: result.summary,
        resolvedEntities: result.resolvedEntities,
        envelope: { data: result.data, summary: result.summary },
      };
    },
  });
};

/** Phase one of a write: resolve, validate, preview. Changes nothing. */
const prepare = async ({ actor, toolName, input = {}, channel = 'text' }) => {
  const inputRef = { accepted: {} };
  return runPhase({
    actor,
    toolName,
    phase: 'prepare',
    kind: 'write',
    channel,
    inputRef,
    run: async () => {
      const guarded = await guard(actor, toolName, input, 'write');
      const clean = guarded.clean;
      inputRef.accepted = clean;

      const prepared = await withTimeout(
        guarded.tool.prepare({ actor, input: clean }),
        guarded.tool.timeoutMs || 10000,
        guarded.tool.name
      );

      const draft = await drafts.create({
        actor,
        tool: guarded.tool.name,
        input: clean,
        resolvedEntities: prepared.resolvedEntities,
        plan: prepared.plan,
        preview: prepared.preview,
      });

      return {
        summary: { draftId: draft.draftId, preview: prepared.preview },
        resolvedEntities: prepared.resolvedEntities,
        envelope: {
          requiresConfirmation: true,
          draftId: draft.draftId,
          integrityHash: draft.integrityHash,
          expiresAt: draft.expiresAt,
          preview: prepared.preview,
        },
      };
    },
  });
};

/**
 * Phase two: commit exactly the draft that was previewed.
 * Committing twice returns the first outcome rather than acting again.
 */
const commit = async ({ actor, draftId, integrityHash, channel = 'text' }) => {
  let draftRef = null;

  try {
    draftRef = await drafts.load(actor, draftId);
  } catch (error) {
    const agentError =
      error instanceof AgentError ? error : new AgentError(CODES.INTERNAL, 'Draft unavailable');
    return { ok: false, phase: 'commit', error: agentError.toJSON() };
  }

  return runPhase({
    actor,
    toolName: draftRef.tool,
    phase: 'commit',
    kind: 'write',
    channel,
    draftId,
    inputRef: { accepted: draftRef.input },
    run: async (correlationId) => {
      const { tool } = await guard(actor, draftRef.tool, draftRef.input, 'write');

      const { claimed, draft } = await drafts.claimForCommit(actor, draftId, integrityHash);

      // Already settled: replay the original outcome, never repeat the action.
      if (!claimed) {
        if (draft.state === 'SUCCEEDED') {
          return {
            summary: { replayed: true, draftId },
            resolvedEntities: draft.resolvedEntities,
            envelope: { data: draft.result, replayed: true, draftId },
          };
        }
        throw new AgentError(
          draft.errorCode || CODES.INVALID_INPUT,
          draft.errorMessage || 'That action did not complete. Please start again.'
        );
      }

      try {
        const result = await withTimeout(
          tool.commit({ actor, draft }),
          tool.timeoutMs || 10000,
          tool.name
        );

        await drafts.settle(draftId, { state: 'SUCCEEDED', result: result.data, correlationId });

        return {
          summary: result.summary,
          resolvedEntities: draft.resolvedEntities,
          envelope: { data: result.data, summary: result.summary, draftId },
        };
      } catch (error) {
        const agentError =
          error instanceof AgentError
            ? error
            : new AgentError(CODES.INTERNAL, 'That action could not be completed');
        await drafts.settle(draftId, {
          state: 'FAILED',
          errorCode: agentError.code,
          errorMessage: agentError.message,
          correlationId,
        });
        throw agentError;
      }
    },
  });
};

const cancelDraft = async ({ actor, draftId }) => {
  try {
    const cancelled = await drafts.cancel(actor, draftId);
    return { ok: true, phase: 'cancel', data: cancelled };
  } catch (error) {
    const agentError =
      error instanceof AgentError ? error : new AgentError(CODES.INTERNAL, 'Could not cancel');
    return { ok: false, phase: 'cancel', error: agentError.toJSON() };
  }
};

/** The tools this actor may currently run, in Grok/OpenAI function shape. */
const availableTools = async (actor) => {
  const enabledModules = await getEnabledModules(actor.companyId);
  return toolSchemasFor({ role: actor.role, enabledModules });
};

module.exports = {
  actorFromRequest,
  execute,
  prepare,
  commit,
  cancelDraft,
  availableTools,
  SOURCE_VERSION,
};
