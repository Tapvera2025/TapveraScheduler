import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { agentApi } from "../../lib/api";

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
// replies with any of these, we skip the LLM round-trip entirely and hit
// /commit (or /cancel) directly. Trailing punctuation is tolerated.
const CONFIRM_RE = /^(y|ye|yes|yeah|yep|yup|ok|okay|k|sure|confirm|do\s+it|go\s+ahead|please\s+do|proceed)[.!?]?$/i;
const DENY_RE    = /^(n|no|nope|nah|cancel|stop|abort|don't|dont|never\s*mind|scratch\s+that|discard)[.!?]?$/i;

export default function useAgent() {
  const queryClient = useQueryClient();

  const [tools, setTools] = useState([]);
  const [toolsError, setToolsError] = useState(null);
  const [toolName, setToolName] = useState("");
  const [values, setValues] = useState({});

  const [phase, setPhase] = useState(PHASES.IDLE);
  const [planning, setPlanning] = useState(false);
  const [history, setHistory] = useState([]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [assistantMessage, setAssistantMessage] = useState("");

  const appendMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, { id: Date.now() + Math.random(), ...msg }]);
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
      hidden: name.endsWith("Id"),
    }));
  }, [tool]);

  const setValue = useCallback((name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const selectTool = useCallback((name) => {
    setToolName(name);
    setValues({});
    setDraft(null);
    setResult(null);
    setError(null);
    setPhase(PHASES.IDLE);
  }, []);

  const reset = useCallback(() => {
    setDraft(null);
    setResult(null);
    setError(null);
    setAssistantMessage("");
    setPhase(PHASES.IDLE);
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setHistory([]);
    setDraft(null);
    setResult(null);
    setError(null);
    setAssistantMessage("");
    setPhase(PHASES.IDLE);
  }, []);

  const runTool = useCallback(
    async (name, payload, kind, userText) => {
      const target = kind || tools.find((t) => t.function?.name === name)?.kind;
      if (!name || !target) return;

      setError(null);
      setResult(null);
      setDraft(null);
      setPhase(PHASES.RUNNING);

      try {
        if (target === "write") {
          const res = await agentApi.prepare(name, payload);
          const draftData = res.data;
          setDraft(draftData);
          setPhase(PHASES.AWAITING_CONFIRMATION);
          appendMessage({ type: "preview", tool: name, draft: draftData });
        } else {
          const res = await agentApi.execute(name, payload);
          const envelope = res.data;
          setResult(envelope);
          setPhase(PHASES.DONE);
          appendMessage({ type: "result", tool: name, envelope });
        }
      } catch (err) {
        const e = readError(err);
        setError(e);
        setPhase(PHASES.IDLE);
        appendMessage({ type: "error", message: e.message, details: e.details });
      }
    },
    [tools, appendMessage]
  );

  const run = useCallback(
    (overrides = {}) => runTool(toolName, { ...values, ...overrides }, tool?.kind),
    [runTool, toolName, values, tool]
  );

  const confirm = useCallback(async () => {
    if (!draft?.draftId || !draft?.integrityHash) return;
    setError(null);
    setPhase(PHASES.COMMITTING);

    // Replace the preview message with a confirmed result
    setMessages((prev) => prev.filter((m) => m.type !== "preview"));

    try {
      const res = await agentApi.commit(draft.draftId, draft.integrityHash);
      const envelope = res.data;
      setResult(envelope);
      setDraft(null);
      setPhase(PHASES.DONE);
      appendMessage({ type: "result", tool: envelope.tool || toolName, envelope });
      await queryClient.invalidateQueries();
    } catch (err) {
      const e = readError(err);
      setError(e);
      setPhase(PHASES.AWAITING_CONFIRMATION);
      appendMessage({ type: "error", message: e.message, details: e.details });
    }
  }, [draft, toolName, queryClient, appendMessage]);

  const cancel = useCallback(async () => {
    if (!draft?.draftId) return reset();
    try {
      await agentApi.cancel(draft.draftId);
    } catch {
      // Draft already settled or expired
    }
    setMessages((prev) => prev.filter((m) => m.type !== "preview"));
    reset();
  }, [draft, reset]);

  const ask = useCallback(
    async (text) => {
      const message = String(text || "").trim();
      if (!message) return;

      // One-word confirmation shortcut. If a draft is currently on-screen and
      // the user replies "yes"/"no"/etc., act on the draft directly rather
      // than paying for a planner turn to interpret it. Preserves the pending
      // action state without any round-trip through the LLM or preResolver.
      if (draft?.draftId && phase === PHASES.AWAITING_CONFIRMATION) {
        if (CONFIRM_RE.test(message)) {
          appendMessage({ type: "user", content: message });
          await confirm();
          return;
        }
        if (DENY_RE.test(message)) {
          appendMessage({ type: "user", content: message });
          await cancel();
          return;
        }
      }

      appendMessage({ type: "user", content: message });
      setPlanning(true);
      setError(null);

      try {
        const res = await agentApi.chat(message, history);
        const data = res.data?.data || {};
        const { kind, message: assistantMsg, pipeline } = data;

        if (assistantMsg) {
          setAssistantMessage(assistantMsg);
          appendMessage({ type: "assistant", content: assistantMsg, pipeline });
        } else {
          setAssistantMessage("");
        }

        setHistory((prev) =>
          [
            ...prev,
            { role: "user", content: message },
            ...(assistantMsg ? [{ role: "assistant", content: assistantMsg }] : []),
          ].slice(-6)
        );

        if (kind === "reply") {
          setPhase(PHASES.IDLE);
        } else if (kind === "read") {
          const envelope = { ok: true, tool: data.tool, data: data.data, summary: data.summary };
          setToolName(data.tool);
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
          setDraft(draftData);
          setPhase(PHASES.AWAITING_CONFIRMATION);
          appendMessage({ type: "preview", tool: data.tool, draft: draftData, pipeline });
        }
      } catch (err) {
        const e = readError(err);
        // INVALID_INPUT and NOT_FOUND always require the user to say something next —
        // show them as conversational assistant bubbles, not red errors.
        // AMBIGUOUS_ENTITY and CONFLICT keep the error path because they render
        // interactive candidate / conflict lists in the UI.
        if (['INVALID_INPUT', 'NOT_FOUND'].includes(e.code)) {
          setAssistantMessage(e.message);
          appendMessage({ type: "assistant", content: e.message });
          setHistory((prev) =>
            [
              ...prev,
              { role: "user", content: message },
              { role: "assistant", content: e.message },
            ].slice(-6)
          );
          setError(null);
          setPhase(PHASES.IDLE);
        } else {
          setError(e);
          setPhase(PHASES.IDLE);
          appendMessage({ type: "error", message: e.message, details: e.details });
        }
      } finally {
        setPlanning(false);
      }
    },
    [history, appendMessage, draft, phase, confirm, cancel]
  );

  const chooseCandidate = useCallback(
    (entity, candidate) => {
      const idField = `${entity}Id`;
      const nameField = `${entity}Name`;
      setValues((prev) => ({ ...prev, [idField]: candidate.id, [nameField]: "" }));
      setError(null);
      run({ [idField]: candidate.id, [nameField]: "" });
    },
    [run]
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
  };
}
