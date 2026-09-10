/**
 * Agent Command Ledger
 *
 * A durable, append-only record of every operation the agent was ASKED to run,
 * not only the ones that changed data. The document plugins used elsewhere
 * record document mutations; this records intent, authorisation, resolution and
 * outcome, which is what an audit of an AI action actually needs.
 *
 * Nothing here is written by the language model. Every field is server-derived.
 */

const mongoose = require('mongoose');

const agentCommandSchema = new mongoose.Schema(
  {
    // Tenant and actor are always taken from the authenticated session,
    // never from tool input.
    companyId: { type: String, required: true, index: true },
    actorUserId: { type: String, required: true, index: true },
    actorRole: { type: String, required: true },

    correlationId: { type: String, required: true, unique: true, index: true },
    idempotencyKey: { type: String, default: null, index: true },

    channel: { type: String, enum: ['text', 'voice'], default: 'text' },
    tool: { type: String, required: true, index: true },
    kind: { type: String, enum: ['read', 'write'], required: true },
    // A write leaves two entries: the preview it was shown, and the commit.
    phase: { type: String, enum: ['plan', 'execute', 'prepare', 'commit'], default: 'execute', index: true },
    draftId: { type: String, default: null, index: true },

    // Input as accepted by the gateway AFTER validation and redaction.
    input: { type: mongoose.Schema.Types.Mixed, default: {} },
    // What free text resolved to, so a wrong-person action is traceable.
    resolvedEntities: { type: mongoose.Schema.Types.Mixed, default: {} },

    outcome: {
      type: String,
      enum: ['SUCCEEDED', 'FAILED', 'DENIED'],
      required: true,
      index: true,
    },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },

    // A compact description of what came back. Never the full result set.
    resultSummary: { type: mongoose.Schema.Types.Mixed, default: null },

    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, required: true },
    durationMs: { type: Number, required: true },

    // Which version of the business rules produced this answer.
    sourceVersion: { type: String, required: true },
  },
  { timestamps: true, minimize: false }
);

agentCommandSchema.index({ companyId: 1, createdAt: -1 });
agentCommandSchema.index({ companyId: 1, tool: 1, createdAt: -1 });

// The ledger is append-only: block updates and deletes at the model layer.
const refuseMutation = function (next) {
  next(new Error('AgentCommand records are append-only'));
};
agentCommandSchema.pre('updateOne', refuseMutation);
agentCommandSchema.pre('updateMany', refuseMutation);
agentCommandSchema.pre('findOneAndUpdate', refuseMutation);
agentCommandSchema.pre('deleteOne', refuseMutation);
agentCommandSchema.pre('deleteMany', refuseMutation);

module.exports = mongoose.model('AgentCommand', agentCommandSchema);
