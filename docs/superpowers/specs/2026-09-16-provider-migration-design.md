# Provider Migration Design — Sub-project A

**Date:** 2026-09-16  
**Status:** Approved  
**Scope:** Replace Gemini / OpenAI GPT / Grok cascade with a single Groq provider for STT, planning, and TTS.

---

## Problem

The agent currently uses three different LLM providers in a waterfall:

1. **Google Gemini** — tried first for both STT (audio transcription) and planning (tool selection)
2. **OpenAI GPT** — primary fallback planner
3. **Grok / xAI** — secondary fallback planner

This causes two concrete bugs and one architectural problem:

- **Bug 1 (TTS always 503):** `/tts` reads `config.agent.apiKey` which does not exist in the config shape. Every TTS request fails silently.
- **Bug 2 (process.env violation):** `/transcribe` accesses `process.env.GROQ_API_KEY` directly, bypassing the central config system the project explicitly forbids bypassing.
- **Bug 3 (stale startup log):** `server/src/index.js` reads `config.agent.model` (does not exist) and logs "no XAI_API_KEY loaded" — both references are already stale.
- **Bug 4 (broken diagnostic):** `server/src/scripts/checkPlanner.js` references `config.agent.apiKey`, `config.agent.baseUrl`, `config.agent.model`, and hardcodes `console.x.ai` URLs and `PLANNER_MODEL` env var names — entirely mismatched to actual config shape.
- **Architecture:** A single user voice command can trigger up to three sequential LLM calls (Gemini → GPT → Grok) on provider failure, multiplying latency unpredictably.

Additionally, `form-data` is required in `agent.routes.js` but is not a declared direct dependency — it works only because a transitive package happens to bring it in.

Llama 4 Scout is not available on the current Groq account. The account has `groq/compound-mini`, Groq's own model purpose-built for tool-calling in compound AI systems, which is a better fit for this use case.

---

## Security note (P0 — do before any code change)

The repository `.env` file contains live credentials. Rotate every key in that file before starting this migration. Remove the `.env` from any shared artifacts or zips. Verify `.gitignore` covers `.env` and `.env.*`.

---

## Decision

Replace all three providers with a **single Groq provider** across all three agent services:

| Service | Model |
|---------|-------|
| STT | `whisper-large-v3-turbo` |
| Planner | `groq/compound-mini` |
| TTS | `canopylabs/orpheus-v1-english` |

All three use the same `GROQ_API_KEY`. One key, one bill, one place to rotate credentials.

---

## Config (`server/src/config/index.js`)

### Env vars removed

```
GEMINI_API_KEY, GEMINI_BASE_URL, GEMINI_MODEL
OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL
XAI_API_KEY, XAI_BASE_URL, XAI_MODEL, XAI_TIMEOUT_MS, XAI_MAX_OUTPUT_TOKENS
PLANNER_API_KEY, PLANNER_BASE_URL, PLANNER_MODEL, PLANNER_TIMEOUT_MS, PLANNER_MAX_OUTPUT_TOKENS
```

### Env vars added

```
GROQ_API_KEY              # required; enables the agent
GROQ_PLANNER_MODEL        # default: groq/compound-mini
GROQ_STT_MODEL            # default: whisper-large-v3-turbo
GROQ_TTS_MODEL            # default: canopylabs/orpheus-v1-english
GROQ_TIMEOUT_MS           # default: 20000
GROQ_MAX_OUTPUT_TOKENS    # default: 300
```

### New `config.agent` shape

```js
agent: {
  groq: {
    apiKey:          envVars.GROQ_API_KEY || '',
    plannerModel:    envVars.GROQ_PLANNER_MODEL,   // groq/compound-mini
    sttModel:        envVars.GROQ_STT_MODEL,        // whisper-large-v3-turbo
    ttsModel:        envVars.GROQ_TTS_MODEL,        // canopylabs/orpheus-v1-english
    baseUrl:         'https://api.groq.com/openai/v1',
    timeoutMs:       envVars.GROQ_TIMEOUT_MS,
    maxOutputTokens: envVars.GROQ_MAX_OUTPUT_TOKENS,
  },
  get enabled() { return Boolean(envVars.GROQ_API_KEY); },
}
```

`baseUrl` is hardcoded — the Groq OpenAI-compatible endpoint is stable and has no per-deployment variant. There is no generic `config.agent.model` — callers always use the specific `plannerModel`, `sttModel`, or `ttsModel` key.

---

## Planner (`server/src/agent/planner.js`)

### Removed

- `callGemini()` (~90 lines) — Gemini envelope conversion, `contents`/`functionDeclarations` mapping
- `cleanForGemini()` (~20 lines) — schema keyword scrubber
- `callGrok()` (~55 lines) — three-provider cascade with conditional branching
- All imports and references to `config.agent.gemini`, `config.agent.primary`, `config.agent.fallback`

### Added: `callGroq()`

Single function (~50 lines) that posts to `${config.agent.groq.baseUrl}/chat/completions` using the OpenAI-compatible format the rest of `plan()` already expects. The retry loop lives **inside** `callGroq()` — `plan()` makes exactly one call to `callGroq()` and never retries at that level.

```
callGroq()
  ├── attempt 1
  └── on retriable error: wait 500–1000 ms → attempt 2
```

Never:

```
plan()
  ├── callGroq()   ← attempt 1
  └── callGroq()   ← attempt 2   ✗ wrong
```

**Retriable errors** (retry once, after 500–1000 ms random jitter):
- `429` — rate-limited
- `ECONNABORTED` — request timeout
- `ECONNRESET`, `ECONNREFUSED` — network reset

**Non-retriable errors** (throw immediately, no retry):
- `401`, `403` — auth/permission failure (won't fix itself)
- `404` — model not found (won't fix itself)
- `400`, `422` — bad request / validation error (won't fix itself)

The 500–1000 ms jitter keeps worst-case latency bounded within the voice agent's perceived-latency budget. A single retry adds at most ~1 s before the caller gets a definitive error.

**Fix in `plan()`:** The usage block currently reads:

```js
model: response?.model || config.agent.primary.model,
```

After migration `config.agent.primary` does not exist. This line must become:

```js
model: response?.model || config.agent.groq.plannerModel,
```

**Return shape:** unchanged — same OpenAI `{ choices, usage, model }` envelope. The remainder of `plan()` is not modified.

`callGrok` is renamed `callGroq` at its one call site inside `plan()`.

---

## Agent Routes (`server/src/routes/agent.routes.js`)

### `/transcribe`

- **Remove** the entire Gemini branch (base64 inline audio, `generateContent` call, ~35 lines)
- **Remove** `const geminiKey = config.agent.gemini.apiKey`
- **Fix** `const groqKey = process.env.GROQ_API_KEY` → destructure `{ apiKey, sttModel, baseUrl }` from `config.agent.groq`
- **Fix** hardcoded URL `'https://api.groq.com/openai/v1/audio/transcriptions'` → `` `${baseUrl}/audio/transcriptions` ``
- **Fix** hardcoded model string `'whisper-large-v3'` → `sttModel`

### `/tts`

- **Fix** `const { apiKey } = config.agent` (broken reference) → destructure `{ apiKey, ttsModel, baseUrl }` from `config.agent.groq`
- **Fix** hardcoded URL `'https://api.groq.com/openai/v1/audio/speech'` → `` `${baseUrl}/audio/speech` ``
- **Fix** hardcoded `'canopylabs/orpheus-v1-english'` → `ttsModel`

---

## Server entry point (`server/src/index.js`)

Line 224–225 currently reads:

```js
config.agent.enabled
  ? `✓ Agent planner ready (${config.agent.model})`
  : '○ Agent planner disabled - no XAI_API_KEY loaded. The assistant will only accept the typed form.'
```

Both references are broken post-migration. Replace with:

```js
config.agent.enabled
  ? `✓ Agent provider ready (Groq / ${config.agent.groq.plannerModel})`
  : '○ Agent disabled — set GROQ_API_KEY in .env. The assistant will only accept the typed form.'
```

---

## Diagnostic script — rename and rewrite

Rename `server/src/scripts/checkPlanner.js` → `server/src/scripts/checkGroq.js`.

The current script references `config.agent.apiKey`, `config.agent.baseUrl`, `config.agent.model`, and `console.x.ai` / `PLANNER_MODEL` — all stale after migration.

Rewrite to:

1. **Show Groq config** — key loaded (yes/no + char count), `baseUrl`, `plannerModel`, `sttModel`, `ttsModel`
2. **GET `${baseUrl}/models`** — verify the key authenticates; list available models
3. **Verify planner model** — confirm `groq/compound-mini` (or configured override) is in the list
4. **Verify STT model** — confirm `whisper-large-v3-turbo` is in the list
5. **Verify TTS model** — confirm `canopylabs/orpheus-v1-english` is in the list
6. **POST `${baseUrl}/chat/completions`** — one real completion with `groq/compound-mini`, confirm response

Error messages must reference `GROQ_*` env vars and `console.groq.com`, not xAI.

---

## Dependency fix

`form-data` is required in `agent.routes.js` but is not declared in `server/package.json`. It currently resolves as a transitive dependency only, which is fragile.

Add it explicitly:

```
npm install form-data
```

This should be done as part of this migration since the migration touches that exact code path.

---

## `.env.example`

Remove all old planner vars. Add the new `GROQ_*` block with inline comments explaining each var.

---

## Scope boundary — unchanged

The following are explicitly out of scope for this change:

- `intentRouter.js`, `preResolver.js`, `normalizer.js`, `gateway.js`, `drafts.js`, `resolver.js`
- All tool files under `agent/tools/`
- All frontend files (`useAgent.js`, `useVoice.js`, `VoiceAssistant.jsx`, `AgentPanel.jsx`, `AgentResult.jsx`)
- The prepare → confirm → commit flow
- Pipeline telemetry fields and structure
- The intent router fast path (addressed in Sub-project B)

---

## Files changed

| File | Nature of change |
|------|-----------------|
| `server/src/config/index.js` | Swap provider config block |
| `server/src/agent/planner.js` | Remove ~165 lines, add ~50 lines (`callGroq` with internal retry) |
| `server/src/routes/agent.routes.js` | Remove Gemini STT branch, fix two credential reads, fix two hardcoded URLs |
| `server/src/index.js` | Fix startup log message (2 broken references) |
| `server/src/scripts/checkPlanner.js` | Rename → `checkGroq.js`, full rewrite for Groq config |
| `server/.env.example` | Remove old vars, add `GROQ_*` block |
| `server/package.json` + `package-lock.json` | Add `form-data` as direct dependency |

---

## Verification checklist

After the change, each of the following must hold:

1. `GROQ_API_KEY` unset → `config.agent.enabled` is `false` → `/chat` returns 503 with "fill in the form" message
2. `GROQ_API_KEY` set → `/transcribe` POSTs to `${baseUrl}/audio/transcriptions` with `whisper-large-v3-turbo`
3. `GROQ_API_KEY` set → `/chat` POSTs to `${baseUrl}/chat/completions` with `groq/compound-mini`
4. `GROQ_API_KEY` set → `/tts` POSTs to `${baseUrl}/audio/speech` with `canopylabs/orpheus-v1-english`
5. Server startup log reads `✓ Agent provider ready (Groq / groq/compound-mini)` when key is set
6. `node src/scripts/checkGroq.js` completes all six verification steps successfully
7. `npm ls form-data --depth=0` in `server/` shows `form-data` as a direct dependency
8. No reference to `process.env.GROQ_API_KEY`, `config.agent.gemini`, `config.agent.primary`, `config.agent.fallback`, `config.agent.apiKey`, `config.agent.model`, `config.agent.baseUrl`, `XAI_API_KEY`, or `console.x.ai` remains anywhere in `server/src/`
9. On a simulated 429 from Groq, `callGroq()` retries exactly once after 500–1000 ms, then throws `plannerUnavailable`
10. On a simulated 401 from Groq, `callGroq()` throws immediately with no retry
11. Pipeline telemetry (`resolveMs`, `normalizeMs`, `routeMs`, `plannerMs`, `totalMs`, `path`) is present and populated in the `/chat` response
