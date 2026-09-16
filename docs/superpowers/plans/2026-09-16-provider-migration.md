# Provider Migration (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Gemini/GPT/Grok cascade with a single Groq provider (compound-mini planner, whisper-large-v3-turbo STT, orpheus-v1-english TTS) and fix two live bugs (broken TTS credential, direct process.env access).

**Architecture:** All three agent services (STT, planning, TTS) share one `GROQ_API_KEY` and read config from `config.agent.groq.*`. The planner uses a single `callGroq()` function with an internal retry loop — `plan()` calls it once and never retries at the outer level. Non-retriable errors (auth, not-found, bad request) throw immediately; retriable errors (rate-limit, timeout, network reset) retry once after 500–1000 ms.

**Tech Stack:** Node.js 18+, Express, axios, form-data, dotenv-flow, Joi — no new runtime dependencies except making `form-data` a declared direct dep.

---

## File map

| File | Change |
|------|--------|
| `server/package.json` | Add `form-data` as direct dep |
| `server/src/config/index.js` | Swap provider config block |
| `server/src/agent/planner.js` | Remove callProvider/callGemini/cleanForGemini/callGrok (~235 lines), add callGroq (~50 lines), fix two stale config refs |
| `server/src/routes/agent.routes.js` | /transcribe: remove Gemini branch, fix credential + URL + model; /tts: fix credential + URL + model |
| `server/src/index.js` | Fix 2 broken startup log references |
| `server/src/scripts/checkGroq.js` | New file — Groq diagnostic (replaces checkPlanner.js) |
| `server/src/scripts/checkPlanner.js` | Delete |
| `server/.env.example` | Remove old agent vars, add GROQ_* block |

---

## Task 1: Security prerequisite — rotate all credentials

> Do this before touching any code. The current `.env` contains live keys that have been shared.

**Files:**
- `server/.env` (manual edit only — never committed)

- [ ] **Step 1: Rotate the Groq API key**

Go to `console.groq.com` → API Keys → delete the key ending in `KZE2` → generate a new key → copy it. Never paste it into chat.

- [ ] **Step 2: Rotate every other key present in server/.env**

Open `server/.env`. For each non-empty key value (Gemini, OpenAI, xAI, AWS, etc.), rotate it at the provider's console. Then clear those values in `.env` — after this migration only `GROQ_API_KEY` is needed for the agent.

- [ ] **Step 3: Add GROQ_API_KEY to server/.env**

Open `server/.env` and add:

```
GROQ_API_KEY=<your-new-groq-key>
```

Do not commit this file. Verify `.gitignore` in `server/` covers `.env`:

```bash
grep "\.env" /Users/archismandutta/Desktop/roster/roster-mechanic/server/.gitignore
```

Expected: at least one line matching `.env` or `.env*`.

---

## Task 2: Add form-data as a direct dependency

**Files:**
- Modify: `server/package.json`
- Modify: `server/package-lock.json`

- [ ] **Step 1: Install form-data**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
npm install form-data
```

Expected output: `added 1 package` (or similar — no errors).

- [ ] **Step 2: Verify it is now a direct dependency**

```bash
npm ls form-data --depth=0
```

Expected: `└── form-data@x.x.x` (not empty).

- [ ] **Step 3: Commit**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git add server/package.json server/package-lock.json
git commit -m "chore: add form-data as direct dependency"
```

---

## Task 3: Update config/index.js

**Files:**
- Modify: `server/src/config/index.js`

- [ ] **Step 1: Replace the planner env var block in the Joi schema**

Find this block (lines ~85–111):

```js
  // Agent planner — Google Gemini (used for BOTH planner and transcription
  // when configured). Preferred over the OpenAI-compatible chain below.
  GEMINI_API_KEY: Joi.string().allow('').optional(),
  GEMINI_BASE_URL: Joi.string().uri().default('https://generativelanguage.googleapis.com/v1beta'),
  // flash-lite has no "thinking" overhead so it fits the sub-1s planner
  // budget. The thinking-enabled 3.x models burn 80+ tokens per turn on
  // internal reasoning even for trivial calls.
  GEMINI_MODEL: Joi.string().default('gemini-3.5-flash-lite'),
  // Agent planner — primary: OpenAI GPT
  OPENAI_API_KEY: Joi.string().allow('').optional(),
  OPENAI_BASE_URL: Joi.string().uri().default('https://api.openai.com/v1'),
  OPENAI_MODEL: Joi.string().default('gpt-4o-mini'),
  // Agent planner — fallback: Grok / any OpenAI-compatible endpoint
  XAI_API_KEY: Joi.string().allow('').optional(),
  XAI_BASE_URL: Joi.string().uri().default('https://api.x.ai/v1'),
  XAI_MODEL: Joi.string().default('grok-3-mini'),
  // Provider-neutral aliases (fallback). The planner speaks plain OpenAI
  // chat-completions, so any compatible endpoint works.
  PLANNER_API_KEY: Joi.string().allow('').optional(),
  PLANNER_BASE_URL: Joi.string().uri().optional(),
  PLANNER_MODEL: Joi.string().optional(),
  PLANNER_TIMEOUT_MS: Joi.number().default(20000),
  PLANNER_MAX_OUTPUT_TOKENS: Joi.number().default(300),
  // Legacy names kept for backwards compat
  XAI_TIMEOUT_MS: Joi.number().optional(),
  XAI_MAX_OUTPUT_TOKENS: Joi.number().optional(),
```

Replace with:

```js
  // Agent — Groq (STT via whisper, planning via compound-mini, TTS via orpheus)
  GROQ_API_KEY: Joi.string().allow('').optional(),
  GROQ_PLANNER_MODEL: Joi.string().default('groq/compound-mini'),
  GROQ_STT_MODEL: Joi.string().default('whisper-large-v3-turbo'),
  GROQ_TTS_MODEL: Joi.string().default('canopylabs/orpheus-v1-english'),
  GROQ_TIMEOUT_MS: Joi.number().default(20000),
  GROQ_MAX_OUTPUT_TOKENS: Joi.number().default(300),
```

- [ ] **Step 2: Replace the config.agent block**

Find this block (lines ~214–245):

```js
  // The planner's credentials live here and never leave the server.
  agent: {
    // Preferred: Google Gemini. Used for both planner and audio transcription.
    // When present, it is tried before the OpenAI-compatible chain below.
    gemini: {
      apiKey: envVars.GEMINI_API_KEY || '',
      baseUrl: envVars.GEMINI_BASE_URL,
      model: envVars.GEMINI_MODEL,
    },
    // Primary: OpenAI GPT
    primary: {
      apiKey: envVars.OPENAI_API_KEY || '',
      baseUrl: envVars.OPENAI_BASE_URL,
      model: envVars.OPENAI_MODEL,
    },
    // Fallback: Grok / any OpenAI-compatible provider
    fallback: {
      apiKey: envVars.PLANNER_API_KEY || envVars.XAI_API_KEY || '',
      baseUrl: envVars.PLANNER_BASE_URL || envVars.XAI_BASE_URL,
      model: envVars.PLANNER_MODEL || envVars.XAI_MODEL,
    },
    timeoutMs: envVars.PLANNER_TIMEOUT_MS || envVars.XAI_TIMEOUT_MS || 20000,
    maxOutputTokens: envVars.PLANNER_MAX_OUTPUT_TOKENS || envVars.XAI_MAX_OUTPUT_TOKENS || 300,
    get enabled() {
      return Boolean(
        envVars.GEMINI_API_KEY ||
          envVars.OPENAI_API_KEY ||
          envVars.PLANNER_API_KEY ||
          envVars.XAI_API_KEY
      );
    },
  },
```

Replace with:

```js
  // Agent provider credentials. Never leave the server.
  agent: {
    groq: {
      apiKey:          envVars.GROQ_API_KEY || '',
      plannerModel:    envVars.GROQ_PLANNER_MODEL,
      sttModel:        envVars.GROQ_STT_MODEL,
      ttsModel:        envVars.GROQ_TTS_MODEL,
      baseUrl:         'https://api.groq.com/openai/v1',
      timeoutMs:       envVars.GROQ_TIMEOUT_MS,
      maxOutputTokens: envVars.GROQ_MAX_OUTPUT_TOKENS,
    },
    get enabled() { return Boolean(envVars.GROQ_API_KEY); },
  },
```

- [ ] **Step 3: Verify the config loads without errors**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
node -e "const c = require('./src/config'); console.log('enabled:', c.agent.enabled); console.log('planner:', c.agent.groq.plannerModel); console.log('stt:', c.agent.groq.sttModel); console.log('tts:', c.agent.groq.ttsModel);"
```

Expected:
```
enabled: true
planner: groq/compound-mini
stt: whisper-large-v3-turbo
tts: canopylabs/orpheus-v1-english
```

- [ ] **Step 4: Commit**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git add server/src/config/index.js
git commit -m "feat: replace multi-provider agent config with single Groq config"
```

---

## Task 4: Rewrite planner.js — remove old providers, add callGroq

**Files:**
- Modify: `server/src/agent/planner.js`

- [ ] **Step 1: Delete callProvider (lines ~60–120)**

Remove the entire `callProvider` function:

```js
const callProvider = async ({ apiKey, baseUrl, model, messages, tools, timeoutMs, maxOutputTokens, label }) => {
  // ... ~60 lines ...
};
```

- [ ] **Step 2: Delete cleanForGemini (lines ~127–136)**

Remove the entire `cleanForGemini` function:

```js
const cleanForGemini = (schema) => {
  // ... ~10 lines ...
};
```

- [ ] **Step 3: Delete callGemini (lines ~145–254)**

Remove the entire `callGemini` function (the long one that maps `contents`/`functionDeclarations` and converts back to OpenAI shape).

- [ ] **Step 4: Delete callGrok (lines ~257–312)**

Remove the entire `callGrok` function (the three-provider cascade).

- [ ] **Step 5: Add callGroq in their place**

After the `stripReserved` function and before `plan`, insert:

```js
const RETRIABLE_CODES = new Set(['ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const callGroq = async ({ messages, tools }) => {
  const { apiKey, plannerModel, baseUrl, timeoutMs, maxOutputTokens } = config.agent.groq;

  const body = {
    model: plannerModel,
    messages,
    tools: tools.map((t) => ({ type: 'function', function: t.function })),
    tool_choice: 'auto',
    temperature: 0,
    max_tokens: maxOutputTokens,
  };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const attempt = async () => {
    try {
      const { data } = await axios.post(`${baseUrl}/chat/completions`, body, {
        timeout: timeoutMs,
        headers,
      });
      return data;
    } catch (error) {
      const status = error.response?.status;
      const providerMsg =
        error.response?.data?.error?.message ||
        JSON.stringify(error.response?.data || {}).slice(0, 300);

      if (status === 401 || status === 403) {
        logger.error('Planner [groq] auth failure', { status, providerMsg, model: plannerModel });
        const err = plannerUnavailable('The assistant is not configured correctly. Check GROQ_API_KEY.');
        err._retriable = false;
        throw err;
      }
      if (status === 404) {
        logger.error('Planner [groq] model not found', { model: plannerModel, providerMsg });
        const err = plannerUnavailable(`The assistant model "${plannerModel}" is not available on this Groq account.`);
        err._retriable = false;
        throw err;
      }
      if (status === 400 || status === 422) {
        logger.error('Planner [groq] bad request', { status, providerMsg });
        const err = plannerUnavailable('The assistant received an invalid request.');
        err._retriable = false;
        throw err;
      }
      if (status === 429) {
        logger.warn('Planner [groq] rate limited', { model: plannerModel });
        const err = plannerUnavailable('The assistant is rate limited right now. Try again shortly.');
        err._retriable = true;
        throw err;
      }
      if (RETRIABLE_CODES.has(error.code)) {
        logger.warn('Planner [groq] network error', { code: error.code });
        const err = new AgentError(CODES.TIMEOUT, 'The assistant took too long to answer.');
        err._retriable = true;
        throw err;
      }

      logger.error('Planner [groq] request failed', { status, error: error.message, model: plannerModel });
      const err = plannerUnavailable('The assistant is unavailable right now.');
      err._retriable = true;
      throw err;
    }
  };

  try {
    return await attempt();
  } catch (firstErr) {
    if (!firstErr._retriable) throw firstErr;
    const backoff = 500 + Math.floor(Math.random() * 500);
    logger.warn('Planner [groq] retrying', { backoffMs: backoff, reason: firstErr.message });
    await sleep(backoff);
    return await attempt();
  }
};
```

- [ ] **Step 6: Fix the two stale references in plan()**

In the `plan()` function, find and replace:

```js
  const tLlmStart = Date.now();
  const response = await callGrok({ messages, tools });
```

→

```js
  const tLlmStart = Date.now();
  const response = await callGroq({ messages, tools });
```

And find:

```js
    model: response?.model || config.agent.primary.model,
```

→

```js
    model: response?.model || config.agent.groq.plannerModel,
```

- [ ] **Step 7: Verify no stale provider references remain in planner.js**

```bash
grep -n "callGrok\|callGemini\|callProvider\|cleanForGemini\|config\.agent\.gemini\|config\.agent\.primary\|config\.agent\.fallback" \
  /Users/archismandutta/Desktop/roster/roster-mechanic/server/src/agent/planner.js
```

Expected: no output (zero matches).

- [ ] **Step 8: Verify the module loads**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
node -e "require('./src/agent/planner'); console.log('planner loaded ok');"
```

Expected: `planner loaded ok`

- [ ] **Step 9: Commit**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git add server/src/agent/planner.js
git commit -m "feat: replace Gemini/GPT/Grok cascade with single callGroq() in planner"
```

---

## Task 5: Fix /transcribe and /tts in agent.routes.js

**Files:**
- Modify: `server/src/routes/agent.routes.js`

- [ ] **Step 1: Replace the /transcribe handler body**

Find the entire `/transcribe` route handler body (from `const pipeline = { stt_start: Date.now() };` through the end of the Gemini branch and the Groq branch). Replace everything between the `withActor` callback opening and the final `res.json(...)` call with:

```js
    const pipeline = { stt_start: Date.now() };

    if (!req.file) {
      return res.status(400).json({ ok: false, error: { code: CODES.INVALID_INPUT, message: 'No audio received' } });
    }

    const { apiKey, sttModel, baseUrl } = config.agent.groq;

    if (!apiKey) {
      return res.status(503).json({ ok: false, error: { code: CODES.PLANNER_UNAVAILABLE, message: 'Transcription is not configured' } });
    }

    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: 'audio.webm',
      contentType: req.file.mimetype || 'audio/webm',
    });
    form.append('model', sttModel);
    form.append('language', 'en');

    let raw = '';
    try {
      const { data } = await axios.post(
        `${baseUrl}/audio/transcriptions`,
        form,
        {
          headers: { Authorization: `Bearer ${apiKey}`, ...form.getHeaders() },
          timeout: 20000,
        }
      );
      raw = (data.text || '').trim();
    } catch (error) {
      const status = error.response?.status;
      logger.error('Whisper transcription failed', { status, error: error.message });
      return res.status(500).json({ ok: false, error: { code: CODES.INTERNAL, message: 'Transcription failed. Try typing instead.' } });
    }

    pipeline.stt_end = Date.now();

    const text = raw
      .replace(/\b(\S+)\s+at\s+(\S+)\s+dot\s+(\S+)\b/gi, '$1@$2.$3')
      .replace(/\b(\S+)\s+at\s+(\S+\.\S+)\b/gi, '$1@$2')
      .trim();

    pipeline.normalizer_end = Date.now();

    res.json({ ok: true, text, pipeline });
```

- [ ] **Step 2: Fix the /tts handler**

Find:

```js
    const { apiKey } = config.agent;
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: { code: CODES.PLANNER_UNAVAILABLE, message: 'TTS is not configured' } });
    }

    try {
      const { data, headers } = await axios.post(
        'https://api.groq.com/openai/v1/audio/speech',
        { model: 'canopylabs/orpheus-v1-english', input: text.trim().slice(0, 4096), voice: 'tara' },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
```

Replace with:

```js
    const { apiKey, ttsModel, baseUrl } = config.agent.groq;
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: { code: CODES.PLANNER_UNAVAILABLE, message: 'TTS is not configured' } });
    }

    try {
      const { data, headers } = await axios.post(
        `${baseUrl}/audio/speech`,
        { model: ttsModel, input: text.trim().slice(0, 4096), voice: 'tara' },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
```

- [ ] **Step 3: Remove the now-unused Employee and Site imports at the top**

Check lines 17–18 in `agent.routes.js`:

```js
const Employee = require('../models/Employee');
const Site = require('../models/Site');
```

These were imported for the Gemini transcription branch. Verify they are not used anywhere else in the file:

```bash
grep -n "Employee\|Site" /Users/archismandutta/Desktop/roster/roster-mechanic/server/src/routes/agent.routes.js
```

If the only matches are the two `require` lines at the top and nowhere else in the file, delete both lines. If they appear elsewhere, leave them.

- [ ] **Step 4: Verify no stale references remain in agent.routes.js**

```bash
grep -n "geminiKey\|GEMINI\|config\.agent\.gemini\|config\.agent\.apiKey\|process\.env\.GROQ_API_KEY\|generateContent\|inlineData" \
  /Users/archismandutta/Desktop/roster/roster-mechanic/server/src/routes/agent.routes.js
```

Expected: no output.

- [ ] **Step 5: Verify the module loads**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
node -e "require('./src/routes/agent.routes'); console.log('agent.routes loaded ok');"
```

Expected: `agent.routes loaded ok`

- [ ] **Step 6: Commit**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git add server/src/routes/agent.routes.js
git commit -m "fix: /transcribe and /tts now use config.agent.groq, remove Gemini STT branch"
```

---

## Task 6: Fix startup log in server/src/index.js

**Files:**
- Modify: `server/src/index.js`

- [ ] **Step 1: Replace the broken agent log lines**

Find (lines ~222–225):

```js
      logger.info(
        config.agent.enabled
          ? `✓ Agent planner ready (${config.agent.model})`
          : '○ Agent planner disabled - no XAI_API_KEY loaded. The assistant will only accept the typed form.'
      );
```

Replace with:

```js
      logger.info(
        config.agent.enabled
          ? `✓ Agent provider ready (Groq / ${config.agent.groq.plannerModel})`
          : '○ Agent disabled — set GROQ_API_KEY in .env. The assistant will only accept the typed form.'
      );
```

- [ ] **Step 2: Commit**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git add server/src/index.js
git commit -m "fix: startup log now references Groq provider and plannerModel"
```

---

## Task 7: Write checkGroq.js and remove checkPlanner.js

**Files:**
- Create: `server/src/scripts/checkGroq.js`
- Delete: `server/src/scripts/checkPlanner.js`

- [ ] **Step 1: Create server/src/scripts/checkGroq.js**

```js
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
```

- [ ] **Step 2: Delete the old checkPlanner.js**

```bash
rm /Users/archismandutta/Desktop/roster/roster-mechanic/server/src/scripts/checkPlanner.js
```

- [ ] **Step 3: Run the new diagnostic**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
node src/scripts/checkGroq.js
```

Expected: all five sections pass, final line is:
```
Groq provider is working. Reload the browser and try the microphone.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git add server/src/scripts/checkGroq.js
git rm server/src/scripts/checkPlanner.js
git commit -m "feat: replace checkPlanner.js with checkGroq.js — verifies all three Groq services"
```

---

## Task 8: Update .env.example

**Files:**
- Modify: `server/.env.example`

- [ ] **Step 1: Replace the agent section**

Find this entire block (lines ~86–119):

```
# ===========================================
# AGENT PLANNER - OPTIONAL
# ===========================================
# Without a key the operations assistant still works through its typed form;
# it simply cannot interpret free text. Keys are only ever used server-side.
#
# PREFERRED — Google Gemini. When set, powers BOTH the planner (function
# calling) and audio transcription. Overrides the OpenAI chain below.
GEMINI_API_KEY=
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
# flash-lite avoids the "thinking" tokens that eat into latency and cost on
# the 3.x thinking-enabled models.
GEMINI_MODEL=gemini-3.5-flash-lite

# PRIMARY — OpenAI GPT (tried when Gemini is not configured)
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini

# FALLBACK — Grok / any OpenAI-compatible endpoint (used when GPT fails)
#   xAI / Grok      https://api.x.ai/v1              grok-3-mini
#   Groq            https://api.groq.com/openai/v1   openai/gpt-oss-20b
#   Ollama, local   http://localhost:11434/v1         llama3.1
PLANNER_API_KEY=
PLANNER_BASE_URL=
PLANNER_MODEL=
PLANNER_TIMEOUT_MS=20000
PLANNER_MAX_OUTPUT_TOKENS=600

# Legacy xAI-specific names, still honoured.
XAI_API_KEY=
XAI_BASE_URL=https://api.x.ai/v1
XAI_MODEL=grok-3-mini
```

Replace with:

```
# ===========================================
# AGENT — GROQ
# ===========================================
# A single GROQ_API_KEY enables all three agent services:
#   STT  →  whisper-large-v3-turbo
#   Plan →  groq/compound-mini  (tool-calling, fast)
#   TTS  →  canopylabs/orpheus-v1-english
#
# Without a key the assistant still works through the typed form.
# Keys are only ever read server-side and never sent to the browser.
#
# Get a key at console.groq.com → API Keys.
# Run `node src/scripts/checkGroq.js` to verify your key works.
GROQ_API_KEY=

# Override defaults only if you need a different model.
# GROQ_PLANNER_MODEL=groq/compound-mini
# GROQ_STT_MODEL=whisper-large-v3-turbo
# GROQ_TTS_MODEL=canopylabs/orpheus-v1-english
# GROQ_TIMEOUT_MS=20000
# GROQ_MAX_OUTPUT_TOKENS=300
```

- [ ] **Step 2: Commit**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git add server/.env.example
git commit -m "docs: update .env.example for Groq-only agent config"
```

---

## Task 9: Final verification

- [ ] **Step 1: Grep for every stale reference across the entire server/src tree**

```bash
grep -rn \
  "config\.agent\.gemini\|config\.agent\.primary\|config\.agent\.fallback\|config\.agent\.apiKey\|config\.agent\.model\|config\.agent\.baseUrl\|process\.env\.GROQ_API_KEY\|GEMINI_API_KEY\|XAI_API_KEY\|PLANNER_API_KEY\|callGrok\|callGemini\|callProvider\|cleanForGemini\|console\.x\.ai\|XAI_MODEL\|PLANNER_MODEL\|no XAI_API_KEY" \
  /Users/archismandutta/Desktop/roster/roster-mechanic/server/src/ \
  --include="*.js"
```

Expected: **no output**. Any match is a bug — fix it before continuing.

- [ ] **Step 2: Start the server and check the startup log**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
npm run dev 2>&1 | grep -E "Agent|agent|GROQ|Groq"
```

Expected line in output:
```
✓ Agent provider ready (Groq / groq/compound-mini)
```

If you see `Agent disabled` instead, `GROQ_API_KEY` is not set in your `.env`.

- [ ] **Step 3: Run the Groq diagnostic**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic/server
node src/scripts/checkGroq.js
```

Expected: all five sections pass.

- [ ] **Step 4: Test /transcribe with a real audio file**

With the server running, record a short clip or use a wav file:

```bash
curl -s -X POST http://localhost:5000/api/v1/agent/transcribe \
  -H "Authorization: Bearer <your-dev-jwt>" \
  -F "audio=@/path/to/test.wav" | jq .
```

Expected response shape:
```json
{ "ok": true, "text": "...", "pipeline": { "stt_start": ..., "stt_end": ... } }
```

- [ ] **Step 5: Test /chat with a simple command**

```bash
curl -s -X POST http://localhost:5000/api/v1/agent/chat \
  -H "Authorization: Bearer <your-dev-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"message": "list employees"}' | jq '.data.pipeline'
```

Expected: `pipeline` object present with `path: "fast"` (since "list employees" hits the deterministic router) and `plannerMs: 0`.

- [ ] **Step 6: Test /tts**

```bash
curl -s -X POST http://localhost:5000/api/v1/agent/tts \
  -H "Authorization: Bearer <your-dev-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"text": "ready"}' \
  --output /tmp/tts-test.wav && \
  echo "TTS OK — $(wc -c < /tmp/tts-test.wav) bytes"
```

Expected: `TTS OK — NNNN bytes` (non-zero). A 503 means TTS is misconfigured or the Orpheus model terms have not been accepted at `console.groq.com/playground`.

- [ ] **Step 7: Final commit tag**

```bash
cd /Users/archismandutta/Desktop/roster/roster-mechanic
git tag provider-migration-a
```

---

## Verification checklist (from spec)

All of these must be true before calling this done:

- [ ] `GROQ_API_KEY` unset → `config.agent.enabled` is `false` → `/chat` returns 503
- [ ] `/transcribe` POSTs to `https://api.groq.com/openai/v1/audio/transcriptions` with `whisper-large-v3-turbo`
- [ ] `/chat` POSTs to `https://api.groq.com/openai/v1/chat/completions` with `groq/compound-mini`
- [ ] `/tts` POSTs to `https://api.groq.com/openai/v1/audio/speech` with `canopylabs/orpheus-v1-english`
- [ ] Startup log reads `✓ Agent provider ready (Groq / groq/compound-mini)`
- [ ] `node src/scripts/checkGroq.js` passes all five checks
- [ ] `npm ls form-data --depth=0` shows form-data as a direct dep
- [ ] Zero stale references in server/src/ (grep from Task 9 Step 1 returns nothing)
- [ ] On 429, `callGroq()` retries once after 500–1000 ms then throws (verify by reading the code)
- [ ] On 401, `callGroq()` throws immediately with `_retriable: false` (verify by reading the code)
- [ ] Pipeline telemetry present in `/chat` response
