/**
 * Agent routes.
 *
 * Mounted behind auth + requireActiveCompany, like every other tenant router.
 * These endpoints carry a typed tool call. They are the same path a voice model
 * will use later, which is the point: voice adds a transport, not a shortcut.
 */

const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const config = require('../config');
const logger = require('../utils/logger');
const {
  actorFromRequest,
  plan,
  execute,
  prepare,
  commit,
  cancelDraft,
  availableTools,
  AgentError,
  CODES,
} = require('../agent');

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Pieces of an email address as a speech recogniser hands them over.
const EMAIL_LOCAL = '[a-z0-9][a-z0-9._+-]*';
const EMAIL_DOMAIN = '[a-z0-9-]+(?:\\.[a-z0-9-]+)*';
const EMAIL_TLD = '[a-z]{2,24}';
const SPOKEN_EMAIL_RE = new RegExp(
  `\\b(${EMAIL_LOCAL})\\s+at\\s+(${EMAIL_DOMAIN})\\s+dot\\s+(${EMAIL_TLD})\\b`,
  'gi'
);
const WRITTEN_EMAIL_RE = new RegExp(
  `\\b(${EMAIL_LOCAL})\\s+at\\s+(${EMAIL_DOMAIN}\\.${EMAIL_TLD})\\b`,
  'gi'
);

// Groq's speech endpoint takes a bounded string. The old cap of 200 sliced
// mid-word, so a two-sentence answer stopped in the middle of the first one.
// Cut at a sentence end where there is one, and never inside a word.
const MAX_TTS_CHARS = 600;

const forSpeech = (value) => {
  const text = String(value).trim();
  if (text.length <= MAX_TTS_CHARS) return text;
  const head = text.slice(0, MAX_TTS_CHARS);
  const sentenceEnd = Math.max(
    head.lastIndexOf('. '),
    head.lastIndexOf('! '),
    head.lastIndexOf('? ')
  );
  if (sentenceEnd > MAX_TTS_CHARS * 0.5) return head.slice(0, sentenceEnd + 1);
  return `${head.replace(/\s+\S*$/, '')}…`;
};

const STATUS_BY_CODE = {
  [CODES.INVALID_INPUT]: 400,
  [CODES.FORBIDDEN]: 403,
  [CODES.MODULE_DISABLED]: 403,
  [CODES.NOT_FOUND]: 404,
  [CODES.AMBIGUOUS_ENTITY]: 409,
  [CODES.CONFLICT]: 409,
  [CODES.LIMIT_EXCEEDED]: 413,
  [CODES.TIMEOUT]: 504,
  [CODES.PLANNER_UNAVAILABLE]: 503,
  [CODES.INTERNAL]: 500,
};

/**
 * Which field a tool refusal is waiting on.
 *
 * Tools name the outstanding field in `details.missing`. Passing it back with
 * the conversation context is what lets the next message be read as the answer
 * to this question rather than handed to the planner to place.
 */
const awaitingField = (error) => {
  const missing = error?.details?.missing;
  return Array.isArray(missing) && typeof missing[0] === 'string' ? missing[0] : null;
};

const withActor = (handler) =>
  asyncHandler(async (req, res) => {
    let actor;
    try {
      actor = actorFromRequest(req);
    } catch (error) {
      if (error instanceof AgentError) {
        return res.status(STATUS_BY_CODE[error.code] || 403).json({
          ok: false,
          error: error.toJSON(),
        });
      }
      throw error;
    }
    return handler(req, res, actor);
  });

/**
 * The operations this user may currently run, as function definitions for the
 * planner. Serving this from the server means the browser never decides what
 * the agent is allowed to do.
 *
 * @route GET /api/agent/tools
 */
router.get(
  '/tools',
  withActor(async (req, res, actor) => {
    const tools = await availableTools(actor);
    res.json({ ok: true, data: { tools, count: tools.length } });
  })
);

/**
 * Run one approved operation.
 *
 * @route POST /api/agent/execute
 * @body  { tool: String, input: Object, channel?: 'text' | 'voice' }
 */
router.post(
  '/execute',
  withActor(async (req, res, actor) => {
    const { tool, input, channel } = req.body || {};

    if (!tool || typeof tool !== 'string') {
      return res.status(400).json({
        ok: false,
        error: { code: CODES.INVALID_INPUT, message: 'A tool name is required' },
      });
    }

    const result = await execute({
      actor,
      toolName: tool,
      input: input || {},
      channel: channel === 'voice' ? 'voice' : 'text',
    });

    const status = result.ok ? 200 : STATUS_BY_CODE[result.error?.code] || 500;
    res.status(status).json(result);
  })
);

/**
 * Phase one of a write: preview it. Nothing is changed by this call.
 *
 * @route POST /api/agent/drafts
 * @body  { tool: String, input: Object, channel?: 'text' | 'voice' }
 */
router.post(
  '/drafts',
  withActor(async (req, res, actor) => {
    const { tool, input, channel } = req.body || {};

    if (!tool || typeof tool !== 'string') {
      return res.status(400).json({
        ok: false,
        error: { code: CODES.INVALID_INPUT, message: 'A tool name is required' },
      });
    }

    const result = await prepare({
      actor,
      toolName: tool,
      input: input || {},
      channel: channel === 'voice' ? 'voice' : 'text',
    });

    res.status(result.ok ? 200 : STATUS_BY_CODE[result.error?.code] || 500).json(result);
  })
);

/**
 * Phase two: carry out exactly the previewed action.
 * The integrity hash from the preview must be echoed back, so a confirmation
 * cannot drift onto a different action.
 *
 * @route POST /api/agent/drafts/:draftId/commit
 * @body  { integrityHash: String, channel?: 'text' | 'voice' }
 */
router.post(
  '/drafts/:draftId/commit',
  withActor(async (req, res, actor) => {
    const { integrityHash, channel } = req.body || {};

    if (!integrityHash || typeof integrityHash !== 'string') {
      return res.status(400).json({
        ok: false,
        error: {
          code: CODES.INVALID_INPUT,
          message: 'The integrity hash from the preview is required to confirm',
        },
      });
    }

    const result = await commit({
      actor,
      draftId: req.params.draftId,
      integrityHash,
      channel: channel === 'voice' ? 'voice' : 'text',
    });

    res.status(result.ok ? 200 : STATUS_BY_CODE[result.error?.code] || 500).json(result);
  })
);

/**
 * Abandon a previewed action.
 *
 * @route POST /api/agent/drafts/:draftId/cancel
 */
router.post(
  '/drafts/:draftId/cancel',
  withActor(async (req, res, actor) => {
    const result = await cancelDraft({ actor, draftId: req.params.draftId });
    res.status(result.ok ? 200 : STATUS_BY_CODE[result.error?.code] || 500).json(result);
  })
);

/**
 * Single-trip chat endpoint: plan + execute/prepare in one request.
 *
 * Eliminates the extra round-trip that the older plan → execute flow required.
 * Returns one of three shapes:
 *   { kind:'reply',   message }              — model needs clarification
 *   { kind:'read',    tool, data, summary }  — read result ready to display
 *   { kind:'write',   tool, draftId, ... }   — write preview awaiting confirm
 *
 * @route POST /api/agent/chat
 * @body  { message: String, history?: [{ role, content }], context?: { tool, input } }
 */
router.post(
  '/chat',
  withActor(async (req, res, actor) => {
    const { message, history, context } = req.body || {};

    let proposal;
    try {
      proposal = await plan({ actor, message, history, context });
    } catch (error) {
      if (error instanceof AgentError) {
        return res.status(STATUS_BY_CODE[error.code] || 500).json({
          ok: false,
          error: error.toJSON(),
        });
      }
      throw error;
    }

    // Text reply — model needs more info from the admin
    if (proposal.kind === 'reply') {
      return res.json({ ok: true, data: { kind: 'reply', message: proposal.message, context: proposal.context || null, usage: proposal.usage, pipeline: proposal.pipeline } });
    }

    if (proposal.kind === 'tool_call') {
      const { tool: toolName, input, toolKind, message: planMessage, usage, pipeline } = proposal;
      // Echo the attempted command even when validation asks for another field.
      // This is untrusted conversational state; all retries still pass the gateway.
      const nextContext = { tool: toolName, input: input || {} };

      if (toolKind === 'read') {
        const result = await execute({ actor, toolName, input: input || {} });
        const status = result.ok ? 200 : (STATUS_BY_CODE[result.error?.code] || 500);
        return res.status(status).json(
          result.ok
            ? { ok: true, data: { kind: 'read', tool: toolName, context: nextContext, correlationId: result.correlationId, message: planMessage, data: result.data, summary: result.summary, usage, pipeline } }
            : { ok: false, error: result.error, context: { ...nextContext, awaiting: awaitingField(result.error) } }
        );
      }

      if (toolKind === 'write') {
        const result = await prepare({ actor, toolName, input: input || {} });
        const status = result.ok ? 200 : (STATUS_BY_CODE[result.error?.code] || 500);
        return res.status(status).json(
          result.ok
            ? { ok: true, data: { kind: 'write', tool: toolName, context: nextContext, correlationId: result.correlationId, message: planMessage, draftId: result.draftId, integrityHash: result.integrityHash, expiresAt: result.expiresAt, preview: result.preview, usage, pipeline } }
            : { ok: false, error: result.error, context: { ...nextContext, awaiting: awaitingField(result.error) } }
        );
      }
    }

    return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Unexpected planner response' } });
  })
);

/**
 * Legacy plan endpoint — kept for voice and direct integrations.
 * New clients should use /chat instead.
 *
 * @route POST /api/agent/plan
 * @body  { message: String, history?: [{ role, content }], context?: { tool, input } }
 */
router.post(
  '/plan',
  withActor(async (req, res, actor) => {
    const { message, history, context } = req.body || {};

    try {
      const proposal = await plan({ actor, message, history, context });
      res.json({ ok: true, data: proposal });
    } catch (error) {
      if (error instanceof AgentError) {
        return res.status(STATUS_BY_CODE[error.code] || 500).json({
          ok: false,
          error: error.toJSON(),
        });
      }
      throw error;
    }
  })
);

/**
 * P0.1/P0.2/P0.5 — Speech-to-text via Groq Whisper.
 *
 * Uses whisper-large-v3 (full model, better accuracy on diverse names).
 * No vocabulary prompt sent — entity resolution is handled by preResolver,
 * not by biasing the STT model (P1.2).
 * Pipeline timestamps returned for observability (P0.5).
 *
 * @route POST /api/agent/transcribe
 * @body  multipart/form-data  audio: audio file
 */
router.post(
  '/transcribe',
  audioUpload.single('audio'),
  withActor(async (req, res, actor) => {
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

    // Normalise spoken email: "archi at tapvera dot io" → "archi@tapvera.io".
    //
    // Both sides have to look like an address. Matching any token around "at"
    // rewrote ordinary speech: "assign Sam at 10.30 to 6.30" came through as
    // "assign Sam@10.30 to 6.30", and the command was gone before the planner
    // ever saw it. A domain now needs a letters-only suffix, which decimal
    // times, room numbers and initials do not have.
    const text = raw
      .replace(SPOKEN_EMAIL_RE, '$1@$2.$3')
      .replace(WRITTEN_EMAIL_RE, '$1@$2')
      .trim();

    pipeline.normalizer_end = Date.now();

    res.json({ ok: true, text, pipeline });
  })
);

/**
 * P0.4 — Neural text-to-speech via Groq Orpheus.
 *
 * Requires org admin to accept model terms at:
 * https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english
 *
 * Returns raw audio (wav) as a binary response so the client can play it
 * via AudioContext without any additional decoding step.
 *
 * @route POST /api/agent/tts
 * @body  { text: String }
 */
router.post(
  '/tts',
  withActor(async (req, res, actor) => {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ ok: false, error: { code: CODES.INVALID_INPUT, message: 'text is required' } });
    }

    const { apiKey, ttsModel, baseUrl } = config.agent.groq;
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: { code: CODES.PLANNER_UNAVAILABLE, message: 'TTS is not configured' } });
    }

    try {
      const { data, headers } = await axios.post(
        `${baseUrl}/audio/speech`,
        { model: ttsModel, input: forSpeech(text), voice: 'diana', response_format: 'wav' },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          responseType: 'arraybuffer',
          timeout: 20000,
        }
      );
      res.set('Content-Type', headers['content-type'] || 'audio/wav');
      res.send(Buffer.from(data));
    } catch (error) {
      const status = error.response?.status;
      logger.error('TTS failed', { status, error: error.message });
      res.status(503).json({ ok: false, error: { code: CODES.PLANNER_UNAVAILABLE, message: 'Neural TTS unavailable. Browser voice will be used.' } });
    }
  })
);

module.exports = router;
