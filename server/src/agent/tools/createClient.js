/**
 * createClient — add a customer the organisation works for.
 *
 * Clients are the top of the chain: a site belongs to a client, and a shift
 * happens at a site. Only the name is genuinely required, so this is the one
 * write that rarely needs a follow-up question.
 */

const clientService = require('../../services/client.service');
const Client = require('../../models/Client');
const { invalidInput, conflict } = require('../errors');

const STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

const parameters = {
  type: 'object',
  properties: {
    clientName: { type: 'string', description: 'The client or customer name. REQUIRED.' },
    state: { type: 'string', description: `Optional Australian state: ${STATES.join(', ')}.` },
    invoicingCompany: { type: 'string', description: 'Optional entity that invoices this client.' },
  },
  additionalProperties: false,
};

const build = async (actor, input) => {
  if (!input.clientName) throw invalidInput('What is the client called?');

  const clientName = input.clientName.trim();

  let state;
  if (input.state) {
    state = input.state.trim().toUpperCase();
    if (!STATES.includes(state)) {
      throw invalidInput(`State must be one of ${STATES.join(', ')}`);
    }
  }

  const existing = await Client.findOne({
    companyId: actor.companyId,
    clientName: new RegExp(`^${clientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
  })
    .select('_id clientName')
    .lean();

  if (existing) {
    throw conflict(`${existing.clientName} is already a client`, {
      clientId: existing._id.toString(),
    });
  }

  return {
    clientName,
    state,
    invoicingCompany: input.invoicingCompany?.trim() || undefined,
  };
};

const prepare = async ({ actor, input }) => {
  const client = await build(actor, input);
  return {
    plan: { ...client },
    preview: {
      action: 'Add client',
      client: client.clientName,
      state: client.state || '—',
      invoicingCompany: client.invoicingCompany || '—',
      notes: ['Sites can be added under this client once it exists.'],
    },
    resolvedEntities: { client: { name: client.clientName } },
  };
};

const commit = async ({ actor, draft }) => {
  const client = await build(actor, draft.input);

  const created = await clientService.createClient(
    { companyId: actor.companyId, userId: actor.userId, role: actor.role },
    { ...client, status: 'ACTIVE' }
  );

  const id = (created?._id || created?.id || '').toString();

  return {
    data: { clientId: id, client: { id, name: client.clientName }, state: client.state || null },
    summary: { created: true, clientId: id, client: client.clientName },
  };
};

module.exports = {
  name: 'createClient',
  description:
    'Add a client the organisation works for. Changes data, so it is previewed and confirmed first. Only the client name is required.',
  kind: 'write',
  modules: ['clients'],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 12000,
  required: ['clientName'],
  parameters,
  prepare,
  commit,
};
