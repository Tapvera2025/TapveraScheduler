/**
 * A proposed write, waiting for a human to confirm it.
 *
 * Drafts live in the database rather than in the model's conversation memory,
 * because "yes" must apply to one exact action that was actually shown to a
 * person. A draft is bound to one tenant, one actor, one tool and one set of
 * resolved entities, and it carries an integrity hash of all of that. Confirming
 * means "commit THIS", not "commit whatever we were last discussing".
 *
 * State is advanced only by atomic expected-state transitions, so two clicks,
 * two tabs, or a retry after a lost response cannot commit the same draft twice.
 */

const mongoose = require('mongoose');

const STATES = [
  'READY_TO_CONFIRM',
  'COMMITTING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
];

const agentDraftSchema = new mongoose.Schema(
  {
    draftId: { type: String, required: true, unique: true, index: true },

    // Server-derived. A draft may only ever be committed by the actor and
    // tenant that created it.
    companyId: { type: String, required: true, index: true },
    actorUserId: { type: String, required: true, index: true },
    actorRole: { type: String, required: true },

    tool: { type: String, required: true },
    input: { type: mongoose.Schema.Types.Mixed, default: {} },
    resolvedEntities: { type: mongoose.Schema.Types.Mixed, default: {} },

    // The exact plan that was previewed, and a hash over it. The commit request
    // must echo the hash, so a draft that changed underneath is refused.
    plan: { type: mongoose.Schema.Types.Mixed, required: true },
    preview: { type: mongoose.Schema.Types.Mixed, required: true },
    integrityHash: { type: String, required: true },

    state: { type: String, enum: STATES, default: 'READY_TO_CONFIRM', index: true },

    // Set once, when the commit succeeds. A repeat commit returns this rather
    // than performing the action again.
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },

    correlationId: { type: String, default: null },
    committedAt: { type: Date, default: null },

    // A draft is deliberately short-lived: a stale preview is a wrong preview.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, minimize: false }
);

// Mongo removes expired drafts on its own; a draft that outlived its preview
// should not be committable even if nothing else cleans it up.
agentDraftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
agentDraftSchema.index({ companyId: 1, actorUserId: 1, createdAt: -1 });

agentDraftSchema.statics.STATES = STATES;

module.exports = mongoose.model('AgentDraft', agentDraftSchema);
