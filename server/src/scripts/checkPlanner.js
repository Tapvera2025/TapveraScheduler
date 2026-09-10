/**
 * Ask xAI directly what is wrong.
 *
 * "Check the API key" covers several very different problems: a revoked key, an
 * account with no credits, a key scoped to a different team, or a model name
 * this account cannot reach. This asks the provider and prints its own answer.
 *
 * The key never leaves this machine and is never printed.
 *
 *   node src/scripts/checkPlanner.js
 */

const axios = require('axios');
const config = require('../config');

const show = (label, value) => console.log(`  ${label.padEnd(22)}${value}`);

const run = async () => {
  console.log('\nPlanner configuration\n');
  show('key loaded:', config.agent.enabled ? `yes (${config.agent.apiKey.length} chars)` : 'NO');
  show('base URL:', config.agent.baseUrl);
  show('model requested:', config.agent.model);

  if (!config.agent.enabled) {
    console.log('\nNo key is loaded. Nothing else to test.\n');
    process.exit(1);
  }

  const auth = { Authorization: `Bearer ${config.agent.apiKey}` };

  // 1. Does the key authenticate at all, independent of any model?
  console.log('\n1. Authentication (GET /models)\n');
  let models = [];
  try {
    const { data } = await axios.get(`${config.agent.baseUrl}/models`, {
      headers: auth,
      timeout: 15000,
    });
    models = (data?.data || []).map((m) => m.id);
    show('result:', 'OK — the key is valid');
    // Not everything a key can reach is a chat model. Separate them, because
    // picking a transcription or safety model here fails confusingly.
    const NOT_CHAT = /whisper|orpheus|prompt-guard|safeguard/i;
    const BUILT_IN_TOOLS = /^groq\/compound/i;
    const chat = models.filter((m) => !NOT_CHAT.test(m) && !BUILT_IN_TOOLS.test(m));
    const other = models.filter((m) => NOT_CHAT.test(m) || BUILT_IN_TOOLS.test(m));

    show('usable for planning:', chat.length ? chat.join(', ') : '(none)');
    if (other.length) show('not chat models:', other.join(', '));
  } catch (error) {
    show('result:', `FAILED — HTTP ${error.response?.status || error.code}`);
    show('provider said:', JSON.stringify(error.response?.data || error.message).slice(0, 400));
    const said = JSON.stringify(error.response?.data || '');
    if (/credit|spending limit|quota|billing/i.test(said)) {
      console.log('\nThe key is valid. The ACCOUNT has no credits (or is at its spending cap).');
      console.log('Load credits at console.x.ai, or point the planner at a free provider:');
      console.log('  PLANNER_BASE_URL / PLANNER_MODEL / PLANNER_API_KEY in server/.env\n');
    } else if (error.response?.status === 401) {
      console.log('\nThe key itself was rejected. It may have been revoked or mistyped.\n');
    } else {
      console.log('\nThe provider refused the request. Its message is above.\n');
    }
    process.exit(1);
  }

  // 2. Is the configured model one this account can actually use?
  if (models.length && !models.includes(config.agent.model)) {
    console.log(`\n  NOTE: "${config.agent.model}" is not in the list above.`);
    console.log('  Set PLANNER_MODEL in server/.env to one of them.\n');
  }

  // 3. The real call the planner makes.
  console.log('\n2. A real completion (POST /chat/completions)\n');
  try {
    const { data } = await axios.post(
      `${config.agent.baseUrl}/chat/completions`,
      {
        model: config.agent.model,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        max_tokens: 10,
        temperature: 0,
      },
      { headers: { ...auth, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    show('result:', 'OK');
    show('model replied:', JSON.stringify(data?.choices?.[0]?.message?.content || '').slice(0, 80));
    show('tokens used:', `${data?.usage?.prompt_tokens || 0} in / ${data?.usage?.completion_tokens || 0} out`);
    console.log('\nThe planner is working. Reload the browser and try the microphone.\n');
    process.exit(0);
  } catch (error) {
    const status = error.response?.status;
    show('result:', `FAILED — HTTP ${status || error.code}`);
    show('provider said:', JSON.stringify(error.response?.data || error.message).slice(0, 400));

    if (status === 403 || status === 402) {
      console.log('\nThe key is valid but the call was refused.');
      console.log('This is usually an account with no credits loaded. Add credits at console.x.ai.\n');
    } else if (status === 404) {
      console.log(`\nThe model "${config.agent.model}" was not found for this account.`);
      console.log('Set PLANNER_MODEL in server/.env to one of the models listed above.\n');
    } else if (status === 429) {
      console.log('\nRate limited. Wait a moment and run this again.\n');
    }
    process.exit(1);
  }
};

run().catch((error) => {
  console.error('\nCheck failed to run:', error.message, '\n');
  process.exit(1);
});
