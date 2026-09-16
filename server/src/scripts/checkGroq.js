/**
 * Groq provider diagnostic.
 *
 * Verifies the GROQ_API_KEY is valid, confirms all three model IDs exist
 * on this account, and performs a real planner completion.
 *
 *   node src/scripts/checkGroq.js
 */

const axios = require('axios');
const config = require('../config');

const show = (label, value) => console.log(`  ${label.padEnd(26)}${value}`);

const run = async () => {
  const { apiKey, plannerModel, sttModel, ttsModel, baseUrl } = config.agent.groq;

  console.log('\nGroq configuration\n');
  show('key loaded:', config.agent.enabled ? `yes (${apiKey.length} chars)` : 'NO — set GROQ_API_KEY in .env');
  show('base URL:', baseUrl);
  show('planner model:', plannerModel);
  show('STT model:', sttModel);
  show('TTS model:', ttsModel);

  if (!config.agent.enabled) {
    console.log('\nNo key loaded. Nothing else to test.\n');
    process.exit(1);
  }

  const auth = { Authorization: `Bearer ${apiKey}` };

  // 1. Authentication + model list
  console.log('\n1. Authentication (GET /models)\n');
  let models = [];
  try {
    const { data } = await axios.get(`${baseUrl}/models`, { headers: auth, timeout: 15000 });
    models = (data?.data || []).map((m) => m.id);
    show('result:', 'OK — key is valid');
    const AUDIO_RE = /whisper|orpheus/i;
    const OTHER_RE = /compound|prompt-guard|safeguard/i;
    const chat = models.filter((m) => !AUDIO_RE.test(m) && !OTHER_RE.test(m));
    const audio = models.filter((m) => AUDIO_RE.test(m));
    const other = models.filter((m) => OTHER_RE.test(m));
    show('chat models:', chat.length ? chat.join(', ') : '(none)');
    if (audio.length) show('audio models:', audio.join(', '));
    if (other.length) show('other models:', other.join(', '));
  } catch (error) {
    show('result:', `FAILED — HTTP ${error.response?.status || error.code}`);
    show('provider said:', JSON.stringify(error.response?.data || error.message).slice(0, 400));
    if (error.response?.status === 401) {
      console.log('\nThe key was rejected. Revoke and regenerate at console.groq.com → API Keys.\n');
    } else {
      console.log('\nThe provider refused the request. Its message is above.\n');
    }
    process.exit(1);
  }

  // 2. Verify planner model
  console.log('\n2. Planner model check\n');
  if (models.length && !models.includes(plannerModel)) {
    show('WARN:', `"${plannerModel}" not in model list`);
    console.log(`  Set GROQ_PLANNER_MODEL in server/.env to one of: ${models.slice(0, 6).join(', ')}\n`);
  } else {
    show(`"${plannerModel}":`, 'found ✓');
  }

  // 3. Verify STT model
  console.log('\n3. STT model check\n');
  if (models.length && !models.includes(sttModel)) {
    show('WARN:', `"${sttModel}" not in model list`);
    console.log('  Set GROQ_STT_MODEL in server/.env.\n');
  } else {
    show(`"${sttModel}":`, 'found ✓');
  }

  // 4. Verify TTS model
  console.log('\n4. TTS model check\n');
  if (models.length && !models.includes(ttsModel)) {
    show('WARN:', `"${ttsModel}" not in model list`);
    console.log('  Accept model terms at console.groq.com/playground, then set GROQ_TTS_MODEL.\n');
  } else {
    show(`"${ttsModel}":`, 'found ✓');
  }

  // 5. Real planner completion
  console.log('\n5. Planner completion (POST /chat/completions)\n');
  try {
    const { data } = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model: plannerModel,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        max_tokens: 10,
        temperature: 0,
      },
      { headers: { ...auth, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
    show('result:', 'OK');
    show('model replied:', JSON.stringify(data?.choices?.[0]?.message?.content || '').slice(0, 80));
    show('tokens used:', `${data?.usage?.prompt_tokens || 0} in / ${data?.usage?.completion_tokens || 0} out`);
  } catch (error) {
    const status = error.response?.status;
    show('result:', `FAILED — HTTP ${status || error.code}`);
    show('provider said:', JSON.stringify(error.response?.data || error.message).slice(0, 400));
    if (status === 404) {
      console.log(`\nModel "${plannerModel}" not found. Set GROQ_PLANNER_MODEL to one of the models listed above.\n`);
    } else if (status === 429) {
      console.log('\nRate limited. Wait a moment and run this again.\n');
    }
    process.exit(1);
  }

  console.log('\nGroq provider is working. Reload the browser and try the microphone.\n');
  process.exit(0);
};

run().catch((error) => {
  console.error('\nCheck failed to run:', error.message, '\n');
  process.exit(1);
});
