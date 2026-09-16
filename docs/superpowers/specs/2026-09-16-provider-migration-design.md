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

- **Bug 1 (TTS always 503):** `/tts` reads `config.agent.apiKey` which does not exist in the config shape. Every TTS request returns 503 silently.
- **Bug 2 (process.env violation):** `/transcribe` accesses `process.env.GROQ_API_KEY` directly, bypassing the central config system the project explicitly forbids bypassing.
- **Architecture:** A single user voice command can trigger up to three sequential LLM calls (Gemini → GPT → Grok) on provider failure, multiplying latency unpredictably.

Additionally, Llama 4 Scout is not available on the current Groq account. The account has `groq/compound-mini`, which is Groq's own model purpose-built for tool-calling in compound AI systems — a better fit than any third-party model for this use case.

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

## Config

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

`baseUrl` is hardcoded — the Groq OpenAI-compatible endpoint is stable and has no per-deployment variant.

---

## Planner (`server/src/agent/planner.js`)

### Removed

- `callGemini()` (~90 lines) — Gemini envelope conversion, `contents`/`functionDeclarations` mapping
- `cleanForGemini()` (~20 lines) — schema keyword scrubber
- `callGrok()` (~55 lines) — three-provider cascade with conditional branching
- All imports and references to `config.agent.gemini`, `config.agent.primary`, `config.agent.fallback`

### Added: `callGroq()`

Single function (~40 lines) that posts to `https://api.groq.com/openai/v1/chat/completions` using the OpenAI-compatible format the rest of `plan()` already expects.

**Retry policy:**
- `429` (rate-limited) or `ECONNABORTED` (timeout) → wait 1 s, retry once
- `401`, `403`, `404`, or any non-retriable error → throw immediately, no retry

**Return shape:** unchanged — same OpenAI `{ choices, usage, model }` envelope. The `plan()` function body is not modified.

`callGrok` is renamed `callGroq` in the one call site inside `plan()`.

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

## `.env.example`

Remove all old planner vars. Add the new `GROQ_*` block with comments.

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
| `server/src/agent/planner.js` | Remove ~165 lines, add ~40 lines |
| `server/src/routes/agent.routes.js` | Remove Gemini STT branch, fix two credential reads |
| `server/.env.example` | Update env var names |

---

## Verification

After the change, the following must pass:

1. `GROQ_API_KEY` unset → `config.agent.enabled` is `false` → `/chat` returns 503 with "fill in the form" message
2. `GROQ_API_KEY` set → `/transcribe` POSTs to `https://api.groq.com/openai/v1/audio/transcriptions` with `whisper-large-v3-turbo`
3. `GROQ_API_KEY` set → `/chat` POSTs to `https://api.groq.com/openai/v1/chat/completions` with `groq/compound-mini`
4. `GROQ_API_KEY` set → `/tts` POSTs to `https://api.groq.com/openai/v1/audio/speech` with `canopylabs/orpheus-v1-english`
5. No reference to `process.env.GROQ_API_KEY`, `config.agent.gemini`, `config.agent.primary`, `config.agent.fallback`, or `config.agent.apiKey` remains in the codebase
6. Pipeline telemetry (`resolveMs`, `normalizeMs`, `routeMs`, `plannerMs`, `totalMs`, `path`) is present and populated in the `/chat` response
