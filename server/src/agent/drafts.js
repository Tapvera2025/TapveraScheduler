/**
 * Draft lifecycle.
 *
 * COLLECTING and RESOLVING happen in the planner's turn and leave no record.
 * A draft appears here only once there is something concrete to show a person,
 * and from that point every transition is atomic and expected-state guarded.
 *
 *   READY_TO_CONFIRM -> COMMITTING -> SUCCEEDED
 *                    |             \
 *                    |              -> FAILED
 *                    -> CANCELLED / expired
 */

const { createHash, randomUUID } = require('crypto');
const AgentDraft = require('../models/AgentDraft');
const { notFound, forbidden, invalidInput, AgentError, CODES } = require('./errors');

const DRAFT_TTL_MS = 10 * 60 * 1000;

/**
 * Stable hash over everything the person was shown. Key order is normalised so
 * the same plan always hashes the same way.
 */
const canonical = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(',')}}`;
};

const hashPlan = ({ tool, input, resolvedEntities, plan }) =>
  createHash('sha256')
    .update(canonical({ tool, input, resolvedEntities, plan }))
    .digest('hex');

const create = async ({ actor, tool, input, resolvedEntities, plan, preview }) => {
  const draftId = randomUUID();
  const integrityHash = hashPlan({ tool, input, resolvedEntities, plan });

  await AgentDraft.create({
    draftId,
    companyId: actor.companyId,
    actorUserId: actor.userId,
    actorRole: actor.role,
    tool,
    input,
    resolvedEntities,
    plan,
    preview,
    integrityHash,
    state: 'READY_TO_CONFIRM',
    expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
  });

  return {
    draftId,
    integrityHash,
    expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
    tool,
    preview,
    resolvedEntities,
  };
};

/**
 * Load a draft the given actor is allowed to act on. A draft belonging to
 * someone else, or to another tenant, is reported as missing rather than
 * refused, so its existence is not disclosed.
 */
const load = async (actor, draftId) => {
  if (!draftId || typeof draftId !== 'string') {
    throw invalidInput('A draft id is required');
  }

  const draft = await AgentDraft.findOne({
    draftId,
    companyId: actor.companyId,
    actorUserId: actor.userId,
  }).lean();

  if (!draft) throw notFound('That draft no longer exists. Please start again.');
  return draft;
};

/**
 * Claim a draft for commit. Atomic: exactly one caller can move a draft out of
 * READY_TO_CONFIRM, so a double click or a retried request cannot act twice.
 *
 * @returns {{ claimed: Boolean, draft: Object }}
 */
const claimForCommit = async (actor, draftId, integrityHash) => {
  const draft = await load(actor, draftId);

  if (new Date(draft.expiresAt) <= new Date()) {
    throw new AgentError(CODES.INVALID_INPUT, 'That draft has expired. Please start again.');
  }

  if (draft.integrityHash !== integrityHash) {
    throw new AgentError(
      CODES.INVALID_INPUT,
      'This confirmation does not match what was previewed. Please review the action again.'
    );
  }

  // Already settled: hand back the original outcome instead of repeating it.
  if (draft.state === 'SUCCEEDED') return { claimed: false, draft };
  if (draft.state === 'FAILED') return { claimed: false, draft };
  if (draft.state === 'CANCELLED') {
    throw new AgentError(CODES.INVALID_INPUT, 'That action was cancelled.');
  }
  if (draft.state === 'COMMITTING') {
    throw new AgentError(
      CODES.INVALID_INPUT,
      'That action is already being carried out. Please wait for the result.'
    );
  }

  const claimed = await AgentDraft.findOneAndUpdate(
    { draftId, state: 'READY_TO_CONFIRM' },
    { $set: { state: 'COMMITTING' } },
    { new: true }
  ).lean();

  if (!claimed) {
    // Someone else won the race between our read and our update.
    const current = await load(actor, draftId);
    return { claimed: false, draft: current };
  }

  return { claimed: true, draft: claimed };
};

const settle = async (draftId, { state, result = null, errorCode = null, errorMessage = null, correlationId = null }) => {
  await AgentDraft.updateOne(
    { draftId },
    {
      $set: {
        state,
        result,
        errorCode,
        errorMessage,
        correlationId,
        committedAt: new Date(),
      },
    }
  );
};

const cancel = async (actor, draftId) => {
  const draft = await load(actor, draftId);
  if (draft.state !== 'READY_TO_CONFIRM') {
    throw invalidInput('That action can no longer be cancelled');
  }
  await AgentDraft.updateOne({ draftId, state: 'READY_TO_CONFIRM' }, { $set: { state: 'CANCELLED' } });
  return { draftId, state: 'CANCELLED' };
};

module.exports = { DRAFT_TTL_MS, hashPlan, create, load, claimForCommit, settle, cancel };
