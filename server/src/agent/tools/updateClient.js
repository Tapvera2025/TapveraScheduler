/**
 * updateClient — rename a client or update their state.
 *
 * build() is shared by prepare and commit so the world is re-validated at
 * confirmation time. The service re-checks clientName uniqueness; build checks
 * it early so the preview can explain the problem before the admin confirms.
 */

const mongoose = require('mongoose');
const Client = require('../../models/Client');
const clientService = require('../../services/client.service');
const { resolveClient } = require('../resolver');
const { invalidInput, notFound, conflict } = require('../errors');

const parameters = {
  type: 'object',
  properties: {
    clientName: { type: 'string', description: 'Current name of the client to update.' },
    clientId: { type: 'string', description: 'Opaque client id from an earlier tool call.' },
    newName: { type: 'string', description: 'New name for the client.' },
    state: { type: 'string', description: 'New state or territory where the client operates.' },
  },
  additionalProperties: false,
};

const resolveClientRef = async (actor, { clientId, clientName }) => {
  if (clientId) {
    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      throw invalidInput('That client reference is not valid');
    }
    const client = await Client.findOne({ _id: clientId, companyId: actor.companyId })
      .select('_id clientName')
      .lean();
    if (!client) throw notFound('That client is not in your organisation', { entity: 'client' });
    return { id: client._id.toString(), name: client.clientName };
  }
  if (clientName) return resolveClient(actor, clientName);
  throw invalidInput('Which client? Give a name or id.', { missing: ['clientName'] });
};

const build = async (actor, input) => {
  const client = await resolveClientRef(actor, input);

  const updates = {};
  if (input.newName !== undefined && input.newName !== null && input.newName.trim() !== '') {
    updates.clientName = input.newName.trim();
  }
  if (input.state !== undefined && input.state !== null && input.state.trim() !== '') {
    updates.state = input.state.trim();
  }

  if (Object.keys(updates).length === 0) {
    throw invalidInput('What should be changed? Provide a new name or state.');
  }

  if (updates.clientName) {
    if (updates.clientName === client.name) {
      throw invalidInput(`That is already the client's name`);
    }
    const existing = await Client.findOne({
      clientName: updates.clientName,
      companyId: actor.companyId,
      _id: { $ne: client.id },
    }).select('_id').lean();
    if (existing) {
      throw conflict(`A client named "${updates.clientName}" already exists in your organisation`);
    }
  }

  return { client, updates };
};

const prepare = async ({ actor, input }) => {
  if (!input.clientName && !input.clientId) {
    throw invalidInput('Which client should I update? Give a name or id.');
  }
  const { client, updates } = await build(actor, input);

  return {
    plan: { clientId: client.id, updates },
    preview: {
      action: 'Update client',
      client: client.name,
      changes: Object.entries(updates).map(([k, v]) => `${k}: ${v}`),
    },
    resolvedEntities: { client },
  };
};

const commit = async ({ actor, draft }) => {
  const { client, updates } = await build(actor, draft.input);

  await clientService.updateClient(
    { companyId: actor.companyId, userId: actor.userId, role: actor.role },
    client.id,
    { ...updates }
  );

  return {
    data: { clientId: client.id, client: updates.clientName || client.name, changes: Object.keys(updates) },
    summary: { updated: true, clientId: client.id, client: updates.clientName || client.name },
  };
};

module.exports = {
  name: 'updateClient',
  description:
    'Update a client — rename them or change their state. This CHANGES data and must be confirmed. Give the client name or id and at least one field to update.',
  kind: 'write',
  modules: [],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 10000,
  required: [],
  parameters,
  prepare,
  commit,
};
