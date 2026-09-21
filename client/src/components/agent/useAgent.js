import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { agentApi } from "../../lib/api";
import { CONFIRM_RE, DENY_RE } from "./confirmation";

/**
 * Client half of the agent state machine.
 *
 * Two distinct arrays:
 *  - `history`  — sanitised [{ role, content }] pairs sent to the LLM planner
 *  - `messages` — richer display thread shown in the chat UI
 *
 *   idle -> running -> awaiting_confirmation -> committing -> done
 *                   \-> done (reads)          \-> error
 */

const PHASES = {
  IDLE: "idle",
  RUNNING: "running",
  AWAITING_CONFIRMATION: "awaiting_confirmation",
  COMMITTING: "committing",
  DONE: "done",
};

const readError = (err) =>
  err?.response?.data?.error || {
    code: "INTERNAL",
    message: err?.message || "Something went wrong",
  };

// One-word confirmation shortcut. When a draft is on-screen and the user
// replies with a bare yes or no, we skip the LLM round-trip entirely and hit
// /commit (or /cancel) directly. The words themselves live in confirmation.js
// so the voice assistant answers to exactly the same ones.
const MAX_HISTORY = 24;

export default function useAgent() {
  const queryClient = useQueryClient();

  const [tools, setTools] = useState([]);
  const [toolsError, setToolsError] = useState(null);
  const [toolName, setToolName] = useState("");
  const [values, setValues] = useState({});

  const [phase, setPhase] = useState(PHASES.IDLE);
  const [planning, setPlanning] = useState(false);
  // Refs keep follow-up turns current even when a cancellation and a new
  // request happen before React has rendered again (for example in voice).
  const historyRef = useRef([]);
  const contextRef = useRef(null);
  const draftRef = useRef(null);
  const failedRequestRef = useRef(null);
  const requestRef = useRef(0);
  const busyRef = useRef(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [assistantMessage, setAssistantMessage] = useState("");
  // Bumped once for every finished turn. Voice keys its "say this once" guard
  // on it: two identical answers in a row are two answers, and without a
  // counter the second one is mistaken for a re-render and never spoken.
  const [outcomeId, setOutcomeId] = useState(0);
  // A question that arrived with its own answers — "which site?" plus the list
  // of sites. Held apart from `error` because a field the tool still needs is a
  // question, not a failure, and must not render as one; the choices have to
  // outlive that distinction so the click still works.
  const [choice, setChoice] = useState(null);
  const choiceRef = useRef(null);

  const noteOutcome = useCallback(() => setOutcomeId((n) => n + 1), []);

  const offerChoice = useCallback((details) => {
    const next =
      details?.entity && details?.candidates?.length
        ? {
            entity: details.entity,
            candidates: details.candidates,
            truncated: Boolean(details.truncated),
          }
        : null;
    choiceRef.current = next;
    setChoice(next);
  }, []);

  const appendMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, { id: Date.now() + Math.random(), ...msg }]);
  }, []);

  const remember = useCallback((...turns) => {
    historyRef.current = [...historyRef.current, ...turns].slice(-MAX_HISTORY);
  }, []);

  const updateContext = useCallback((context) => {
    contextRef.current = context || null;
    if (context?.tool) {
      setToolName(context.tool);
      setValues(context.input || {});
    }
  }, []);

  const updateDraft = useCallback((next) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    agentApi
      .getTools()
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.data?.tools || [];
        setTools(list);
        setToolName((current) => current || list[0]?.function?.name || "");
      })
      .catch((err) => !cancelled && setToolsError(readError(err)));
    return () => { cancelled = true; };
  }, []);

  const tool = useMemo(
    () => tools.find((t) => t.function?.name === toolName) || null,
    [tools, toolName]
  );

  const fields = useMemo(() => {
    const props = tool?.function?.parameters?.properties || {};
    const required = tool?.required || [];
    return Object.entries(props).map(([name, schema]) => ({
      name,
      description: schema.description || "",
      required: required.includes(name),
      // Ids come from choices and coordinates from the map picker; neither is
      // something to type into a box.
      hidden: name.endsWith("Id") || name === "latitude" || name === "longitude",
    }));
  }, [tool]);

  const setValue = useCallback((name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const selectTool = useCallback((name) => {
    requestRef.current += 1;
    busyRef.current = false;
    contextRef.current = null;
    failedRequestRef.current = null;
    choiceRef.current = null;
    setChoice(null);
    setToolName(name);
    setValues({});
    updateDraft(null);
    setResult(null);
    setError(null);
    setPlanning(false);
    setPhase(PHASES.IDLE);
  }, [updateDraft]);

  const reset = useCallback(() => {
    requestRef.current += 1;
    busyRef.current = false;
    contextRef.current = null;
    failedRequestRef.current = null;
    choiceRef.current = null;
    setChoice(null);
    updateDraft(null);
    setResult(null);
    setError(null);
    setAssistantMessage("");
    setPlanning(false);
    setPhase(PHASES.IDLE);
  }, [updateDraft]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    historyRef.current = [];
    reset();
  }, [reset]);

  const runTool = useCallback(
    async (name, payload, kind, userText) => {
      const target = kind || tools.find((t) => t.function?.name === name)?.kind;
      if (!name || !target || busyRef.current) return;

      busyRef.current = true;
      const requestId = ++requestRef.current;
      updateContext({ tool: name, input: payload });
      if (userText) {
        appendMessage({ type: "user", content: userText });
        remember({ role: "user", content: userText });
      }

      setError(null);
      setResult(null);
      updateDraft(null);
      setAssistantMessage("");
      offerChoice(null);
      setMessages((prev) => prev.filter((m) => m.type !== "preview"));
      setPhase(PHASES.RUNNING);

      try {
        if (target === "write") {
          const res = await agentApi.prepare(name, payload);
          if (requestId !== requestRef.current) return;
          const draftData = res.data;
          updateDraft(draftData);
          setPhase(PHASES.AWAITING_CONFIRMATION);
          noteOutcome();
          appendMessage({ type: "preview", tool: name, draft: draftData });
          remember({ role: "assistant", content: `Prepared ${name}; awaiting confirmation. Nothing has been saved yet.` });
        } else {
          const res = await agentApi.execute(name, payload);
          if (requestId !== requestRef.current) return;
          const envelope = res.data;
          updateContext(null);
          setResult(envelope);
          setPhase(PHASES.DONE);
          noteOutcome();
          appendMessage({ type: "result", tool: name, envelope });
          remember({ role: "assistant", content: `Completed ${name}; the result was displayed.` });
        }
        failedRequestRef.current = null;
      } catch (err) {
        if (requestId !== requestRef.current) return;
        const e = readError(err);
        remember({ role: "assistant", content: e.message });
        setError(e);
        setPhase(PHASES.IDLE);
        offerChoice(e.details);
        noteOutcome();
        appendMessage({ type: "error", message: e.message, details: e.details });
      } finally {
        if (requestId === requestRef.current) busyRef.current = false;
      }
    },
    [tools, appendMessage, remember, noteOutcome, offerChoice, updateContext, updateDraft]
  );

  const run = useCallback(
    (overrides = {}) => runTool(toolName, { ...values, ...overrides }, tool?.kind),
    [runTool, toolName, values, tool]
  );

  const confirm = useCallback(async () => {
    const pending = draftRef.current;
    if (!pending?.draftId || !pending?.integrityHash || busyRef.current) return;
    busyRef.current = true;
    const requestId = ++requestRef.current;
    setError(null);
    setPhase(PHASES.COMMITTING);

    try {
      const res = await agentApi.commit(pending.draftId, pending.integrityHash);
      if (requestId !== requestRef.current) return;
      const envelope = res.data;
      const completedTool = envelope.tool || contextRef.current?.tool || toolName;
      setResult(envelope);
      updateDraft(null);
      updateContext(null);
      failedRequestRef.current = null;
      setPhase(PHASES.DONE);
      noteOutcome();
      setMessages((prev) => prev.filter((m) => m.type !== "preview"));
      appendMessage({ type: "result", tool: completedTool, envelope });
      remember({ role: "assistant", content: `Confirmed and completed ${completedTool}. The change was saved.` });
      await queryClient.invalidateQueries();
    } catch (err) {
      if (requestId !== requestRef.current) return;
      const e = readError(err);
      remember({ role: "assistant", content: `Confirmation failed: ${e.message}` });
      setError(e);
      setPhase(PHASES.AWAITING_CONFIRMATION);
      noteOutcome();
      appendMessage({ type: "error", message: e.message, details: e.details });
    } finally {
      if (requestId === requestRef.current) busyRef.current = false;
    }
  }, [toolName, queryClient, appendMessage, remember, noteOutcome, updateContext, updateDraft]);

  const cancel = useCallback(async () => {
    if (busyRef.current) return;
    const pending = draftRef.current;
    const cancelledTool = contextRef.current?.tool || toolName;
    if (!pending?.draftId) return reset();
    busyRef.current = true;
    const requestId = ++requestRef.current;
    setPhase(PHASES.RUNNING);
    try {
      try {
        await agentApi.cancel(pending.draftId);
      } catch {
        // Draft already settled or expired
      }
      if (requestId !== requestRef.current) return;
      setMessages((prev) => prev.filter((m) => m.type !== "preview"));
      remember({ role: "assistant", content: `Cancelled ${cancelledTool}; no change was saved.` });
      reset();
      // reset() clears this, so it has to be set after. Cancelling needs to
      // leave something behind: with nothing to announce, voice has nothing to
      // say and never reopens the microphone.
      setAssistantMessage("Cancelled. Nothing was saved.");
      noteOutcome();
    } finally {
      // Every other phase clears the flag in a finally. This one returns early
      // when it is overtaken, and relies on whoever overtook it to have done
      // so. Clearing it here too costs nothing and means a raised flag can
      // never outlive the call that raised it — a stuck flag drops every later
      // command without a word.
      if (requestId === requestRef.current) busyRef.current = false;
    }
  }, [toolName, reset, remember, noteOutcome]);

  /**
   * One turn in. Returns false only when a turn was refused because the last
   * one is still running, so a caller that cannot see the screen — the voice
   * assistant — can say so instead of leaving the person talking to a closed
   * microphone. Nothing to say is not a refusal.
   */
  const ask = useCallback(
    async (text) => {
      const message = String(text || "").trim();
      if (!message) return;
      if (busyRef.current) return false;

      // One-word confirmation shortcut. If a draft is currently on-screen and
      // the user replies "yes"/"no"/etc., act on the draft directly rather
      // than paying for a planner turn to interpret it. Preserves the pending
      // action state without any round-trip through the LLM or preResolver.
      if (draftRef.current?.draftId) {
        if (CONFIRM_RE.test(message)) {
          appendMessage({ type: "user", content: message });
          remember({ role: "user", content: message });
          await confirm();
          return true;
        }
        if (DENY_RE.test(message)) {
          appendMessage({ type: "user", content: message });
          remember({ role: "user", content: message });
          await cancel();
          return true;
        }
      }

      busyRef.current = true;
      const requestId = ++requestRef.current;
      const previousDraft = draftRef.current;
      updateDraft(null);
      failedRequestRef.current = null;
      appendMessage({ type: "user", content: message });
      setPlanning(true);
      setError(null);
      setResult(null);
      setAssistantMessage("");
      offerChoice(null);
      setPhase(PHASES.RUNNING);
      setMessages((prev) => prev.filter((m) => m.type !== "preview"));

      try {
        if (previousDraft?.draftId) {
          try {
            await agentApi.cancel(previousDraft.draftId);
          } catch {
            // Expired drafts are also no longer confirmable in this thread.
          }
          if (requestId !== requestRef.current) return;
          remember({ role: "assistant", content: "Discarded the previous preview before this new request; no change was saved." });
        }
        const res = await agentApi.chat(message, historyRef.current, contextRef.current);
        if (requestId !== requestRef.current) return;
        const data = res.data?.data || {};
        const { kind, message: assistantMsg, pipeline } = data;
        if (data.context !== undefined) updateContext(data.context);

        if (assistantMsg) {
          setAssistantMessage(assistantMsg);
          appendMessage({ type: "assistant", content: assistantMsg, pipeline });
        } else {
          setAssistantMessage("");
        }

        const outcome = kind === "read"
          ? `Completed ${data.tool}; the result was displayed.`
          : kind === "write"
            ? `Prepared ${data.tool}; awaiting confirmation. Nothing has been saved yet.`
            : "";
        remember(
          { role: "user", content: message },
          { role: "assistant", content: [assistantMsg, outcome].filter(Boolean).join(" ") }
        );

        noteOutcome();

        if (kind === "reply") {
          setPhase(PHASES.IDLE);
        } else if (kind === "read") {
          const envelope = {
            ok: true,
            tool: data.tool,
            correlationId: data.correlationId,
            data: data.data,
            summary: data.summary,
          };
          setToolName(data.tool);
          updateContext(null);
          setResult(envelope);
          setPhase(PHASES.DONE);
          appendMessage({ type: "result", tool: data.tool, envelope, pipeline });
        } else if (kind === "write") {
          const draftData = {
            ok: true,
            draftId: data.draftId,
            integrityHash: data.integrityHash,
            expiresAt: data.expiresAt,
            preview: data.preview,
          };
          setToolName(data.tool);
          updateDraft(draftData);
          setPhase(PHASES.AWAITING_CONFIRMATION);
          appendMessage({ type: "preview", tool: data.tool, draft: draftData, pipeline });
        }
      } catch (err) {
        if (requestId !== requestRef.current) return;
        const e = readError(err);
        const failedContext = err?.response?.data?.context;
        if (failedContext !== undefined) updateContext(failedContext);
        failedRequestRef.current = message;
        remember(
          { role: "user", content: message },
          { role: "assistant", content: e.message }
        );
        // INVALID_INPUT and NOT_FOUND always require the user to say something next —
        // show them as conversational assistant bubbles, not red errors.
        // AMBIGUOUS_ENTITY and CONFLICT keep the error path because they render
        // interactive candidate / conflict lists in the UI.
        offerChoice(e.details);
        if (['INVALID_INPUT', 'NOT_FOUND'].includes(e.code)) {
          setAssistantMessage(e.message);
          appendMessage({ type: "assistant", content: e.message, details: e.details });
          setError(null);
          setPhase(PHASES.IDLE);
        } else {
          setError(e);
          setPhase(PHASES.IDLE);
          appendMessage({ type: "error", message: e.message, details: e.details });
        }
        noteOutcome();
      } finally {
        if (requestId === requestRef.current) {
          busyRef.current = false;
          setPlanning(false);
        }
      }
      return true;
    },
    [appendMessage, confirm, cancel, remember, noteOutcome, offerChoice, updateContext, updateDraft]
  );

  /**
   * Re-prepare the change in progress with extra fields supplied by the app
   * rather than typed — the map picker's location, for one. The old draft is
   * cancelled, the tool runs again with everything collected so far plus the
   * new fields, and a fresh preview replaces the old one. Nothing is saved
   * until that new preview is confirmed.
   */
  const revise = useCallback(
    async (fields, label) => {
      const context = contextRef.current;
      if (!context?.tool || busyRef.current) return;

      const previous = draftRef.current;
      if (previous?.draftId) {
        try {
          await agentApi.cancel(previous.draftId);
        } catch {
          // Already settled or expired; the new draft supersedes it either way.
        }
      }
      return runTool(context.tool, { ...context.input, ...fields }, undefined, label);
    },
    [runTool]
  );

  const chooseCandidate = useCallback(
    (entity, candidate) => {
      const offered = choiceRef.current;
      if (busyRef.current
          || !offered
          || offered.entity !== entity
          || !offered.candidates.some((c) => c.id === candidate.id)) return;
      const idField = `${entity}Id`;
      const nameField = `${entity}Name`;
      const selection = `Use ${candidate.name} (${idField}: ${candidate.id}).`;
      const context = contextRef.current;
      if (context?.tool) {
        return runTool(context.tool, { ...context.input, [idField]: candidate.id, [nameField]: "" }, undefined, selection);
      }
      // Resolution can fail before a tool is planned. Re-plan that request,
      // rather than executing whichever tool happened to run previously.
      if (failedRequestRef.current) return ask(`${failedRequestRef.current}\n${selection}`);
    },
    [ask, runTool]
  );

  return {
    PHASES,
    tools,
    toolsError,
    tool,
    toolName,
    fields,
    values,
    phase,
    draft,
    result,
    error,
    planning,
    assistantMessage,
    outcomeId,
    choice,
    messages,
    busy: phase === PHASES.RUNNING || phase === PHASES.COMMITTING || planning,
    selectTool,
    setValue,
    run,
    ask,
    confirm,
    cancel,
    reset,
    clearHistory,
    chooseCandidate,
    revise,
  };
}
