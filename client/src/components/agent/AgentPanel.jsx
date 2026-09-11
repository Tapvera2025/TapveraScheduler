import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ListChecks,
  Loader2,
  Plus,
  SendHorizontal,
  Sparkles,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Label } from "../ui/Label";
import useAgent from "./useAgent";
import AgentResult from "./AgentResult";

const titleCase = (name) =>
  name.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

const QUICK_ACTIONS = [
  { label: "Today's roster", prompt: "Who is rostered today?", icon: CalendarDays },
  { label: "Find employee shifts", prompt: "Find shifts for ", icon: ListChecks },
  { label: "Add a shift", prompt: "Add a shift for ", icon: Plus },
  { label: "List employees", prompt: "List all employees", icon: Users },
];

// Progressive "thinking" indicator. Cycles through plausible stages every 450ms
// so the wait feels active rather than dead. This is client-side theatre — the
// server does not stream per-stage events — but it maps to real phases we know
// the request is going through.
const THINKING_STAGES = [
  "Understanding what you asked…",
  "Checking your data…",
  "Almost there…",
];

function ThinkingIndicator({ busy, planning, awaitingCommit }) {
  // Parent unmounts this component when busy/planning both become false, so
  // stage automatically resets to 0 on each new thinking cycle — no explicit
  // reset needed inside the effect.
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!planning && !busy) return;
    const id = setInterval(() => {
      setStage((s) => Math.min(s + 1, THINKING_STAGES.length - 1));
    }, 450);
    return () => clearInterval(id);
  }, [planning, busy]);

  const label = awaitingCommit
    ? "Confirming…"
    : planning
      ? THINKING_STAGES[stage]
      : "Running…";

  return (
    <div className="agent-msg agent-msg--assistant">
      <Loader2 size={12} className="animate-spin shrink-0 mt-0.5" />
      <span className="text-[hsl(var(--color-foreground-muted))]">{label}</span>
    </div>
  );
}

// Small badge showing how the request was served: fast deterministic path vs.
// LLM planner, plus total pipeline time. Data comes from planner.js and is
// harmless to expose — it is not user data, it is our own latency.
function PipelineBadge({ pipeline }) {
  if (!pipeline || typeof pipeline.totalMs !== "number") return null;
  const fast = pipeline.path === "fast";
  return (
    <span
      className="agent-pipeline-badge"
      title={`${fast ? "Fast path" : "AI planner"} · ${pipeline.totalMs}ms total`}
    >
      {fast ? <Zap size={9} /> : <Sparkles size={9} />}
      {fast ? "Fast" : "AI"} · {pipeline.totalMs}ms
    </span>
  );
}

/** Render a generic write-preview from the preview object returned by any tool's prepare(). */
function WritePreview({ preview, skip = [] }) {
  const SKIP = new Set(["action", "notes", "conflicts", ...skip]);
  const LABELS = {
    employee: "Employee",
    site: "Site",
    start: "Start",
    end: "End",
    hours: "Hours",
    paidHours: "Paid hours",
    shiftType: "Type",
    breakMinutes: "Break (min)",
    crossesMidnight: "Overnight",
    email: "Email",
    position: "Position",
    department: "Department",
    phone: "Phone",
    client: "Client",
    state: "State",
    invoicingCompany: "Invoiced by",
    shortName: "Short code",
    timezone: "Timezone",
    address: "Address",
    townSuburb: "Suburb / Town",
    status: "Current status",
    timezone: "Timezone",
  };

  const facts = Object.entries(preview)
    .filter(([k, v]) => !SKIP.has(k) && v !== null && v !== undefined && v !== "—" && v !== false)
    .map(([k, v]) => {
      let display = String(v);
      if (k === "hours" && preview.paidHours != null)
        display = `${v}h gross · ${preview.paidHours}h paid`;
      else if (typeof v === "boolean") display = v ? "Yes" : "No";
      return [LABELS[k] || titleCase(k), display];
    })
    .filter(([, v]) => v !== "undefined" && v !== "null");

  return (
    <dl className="agent-facts">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Single message bubble in the chat thread. */
function MessageBubble({ msg, agent }) {
  const candidates = msg.details?.candidates || [];
  const conflicts = msg.details?.conflicts || [];

  if (msg.type === "user") {
    return (
      <div className="agent-msg agent-msg--user">
        <span>{msg.content}</span>
      </div>
    );
  }

  if (msg.type === "assistant") {
    return (
      <div className="agent-msg agent-msg--assistant">
        <Sparkles size={12} className="shrink-0 mt-0.5" />
        <span>{msg.content}</span>
      </div>
    );
  }

  if (msg.type === "result") {
    return (
      <div className="agent-msg agent-msg--result">
        <AgentResult envelope={msg.envelope} />
        <PipelineBadge pipeline={msg.pipeline} />
      </div>
    );
  }

  if (msg.type === "preview") {
    const { draft } = msg;
    const preview = draft?.preview;
    if (!preview) return null;
    // Hero line: employee, then time · site if we have them. This is what the
    // manager actually needs to see — the "data first, explanation second"
    // rule from the design doc. Everything else stays in the fact grid below.
    const hasTimeSite = preview.start && preview.end && (preview.site || preview.employee);
    return (
      <div className="agent-msg agent-msg--preview">
        <p className="eyebrow">READY TO CONFIRM</p>
        <h4>{preview.action}</h4>
        {(preview.employee || hasTimeSite) && (
          <div className="agent-action-hero">
            {preview.employee && <div className="agent-action-who">{preview.employee}</div>}
            {hasTimeSite && (
              <div className="agent-action-when">
                {preview.start} → {preview.end}
                {preview.site && <> · {preview.site}</>}
              </div>
            )}
          </div>
        )}
        <WritePreview preview={preview} skip={preview.employee ? ["employee", "start", "end", "site"] : []} />
        {preview.notes?.length > 0 && (
          <ul className="agent-notes">
            {preview.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}
        <div className="agent-confirm-row">
          <Button variant="outline" size="sm" onClick={agent.cancel} disabled={agent.busy}>
            Cancel
          </Button>
          <Button onClick={agent.confirm} disabled={agent.busy} size="sm">
            {agent.busy && <Loader2 size={13} className="animate-spin" />}
            Confirm
          </Button>
        </div>
        <div className="agent-preview-foot">
          <span className="agent-provenance">Plan {draft.integrityHash?.slice(0, 12)}…</span>
          <PipelineBadge pipeline={msg.pipeline} />
        </div>
      </div>
    );
  }

  if (msg.type === "error") {
    return (
      <div className="agent-msg agent-msg--error">
        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p>{msg.message}</p>
          {candidates.length > 0 && (
            <div className="agent-candidates mt-2">
              <p className="eyebrow">DID YOU MEAN</p>
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="agent-candidate"
                  onClick={() => agent.chooseCandidate(msg.details?.entity, c)}
                >
                  <strong>{c.name}</strong>
                  <span>
                    {[c.position, c.department, c.shortName].filter(Boolean).join(" · ") || "—"}
                  </span>
                </button>
              ))}
            </div>
          )}
          {conflicts.length > 0 && (
            <div className="agent-candidates mt-2">
              <p className="eyebrow">CLASHES WITH</p>
              {conflicts.map((c) => (
                <div key={c.shiftId} className="agent-candidate is-static">
                  <strong>{c.site || "Unassigned site"}</strong>
                  <span>{c.start} → {c.end}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

export default function AgentPanel({ open, onClose }) {
  const agent = useAgent();
  const [question, setQuestion] = useState("");
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  const { PHASES, tools, toolsError, tool, fields, values, phase, messages, busy, planning } =
    agent;

  // Auto-scroll body to bottom when new messages arrive
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, busy, planning]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  if (!open) return null;

  const hasHistory = messages.length > 0;
  const awaitingConfirm = phase === PHASES.AWAITING_CONFIRMATION;
  const showForm = tool && !awaitingConfirm && !hasHistory;

  const handleSend = (e) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    agent.ask(q);
    setQuestion("");
  };

  const handleQuickAction = (prompt) => {
    if (prompt.endsWith(" ")) {
      setQuestion(prompt);
      inputRef.current?.focus();
    } else {
      agent.ask(prompt);
    }
  };

  return (
    <aside className="agent-panel" aria-label="Operations assistant">
      {/* Header */}
      <header className="agent-panel-head">
        <div className="agent-panel-title">
          <Sparkles size={16} />
          <strong>Operations</strong>
          <span className="agent-dev-tag" title="This assistant is still under active development">
            UNDER DEVELOPMENT
          </span>
        </div>
        <div className="flex items-center gap-1">
          {hasHistory && (
            <button
              type="button"
              className="icon-button"
              onClick={agent.clearHistory}
              aria-label="Clear conversation"
              title="Clear conversation"
            >
              <Trash2 size={15} />
            </button>
          )}
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </header>

      {/* Body — scrollable; ref used for auto-scroll to latest message */}
      <div className="agent-panel-body" ref={threadRef}>
        {toolsError && <p className="agent-error">{toolsError.message}</p>}

        {/* Quick actions — shown only when conversation is empty */}
        {!hasHistory && !busy && (
          <div className="agent-quick-actions">
            <p className="eyebrow">QUICK ACTIONS</p>
            <div className="agent-quick-grid">
              {QUICK_ACTIONS.map(({ label, prompt, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  className="agent-quick-btn"
                  onClick={() => handleQuickAction(prompt)}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tool selector — only shown when no conversation yet */}
        {!hasHistory && tools.length > 0 && (
          <div className="agent-tools">
            {tools.map((t) => (
              <button
                key={t.function.name}
                type="button"
                onClick={() => agent.selectTool(t.function.name)}
                className={`agent-tool ${agent.toolName === t.function.name ? "is-active" : ""}`}
              >
                {titleCase(t.function.name)}
                {t.kind === "write" && <span className="agent-tool-flag">write</span>}
              </button>
            ))}
          </div>
        )}

        {/* Form — shown when no conversation, tool selected */}
        {showForm && (
          <div className="agent-form-block">
            <p className="agent-description">{tool.function.description}</p>
            <div className="agent-form">
              {fields
                .filter((f) => !f.hidden)
                .map((field) => (
                  <label key={field.name} className="agent-field">
                    <span>
                      {titleCase(field.name)}
                      {field.required && <em> required</em>}
                    </span>
                    <Input
                      value={values[field.name] || ""}
                      onChange={(e) => agent.setValue(field.name, e.target.value)}
                      placeholder={field.description.split(".")[0]}
                      disabled={busy}
                    />
                  </label>
                ))}
            </div>
            {Object.entries(values)
              .filter(([k, v]) => k.endsWith("Id") && v)
              .map(([k, v]) => (
                <p key={k} className="agent-pinned">
                  {titleCase(k.replace(/Id$/, ""))} pinned to {String(v).slice(-6)}
                  <button type="button" onClick={() => agent.setValue(k, "")}>
                    clear
                  </button>
                </p>
              ))}
            <Button onClick={() => agent.run()} disabled={busy} className="w-full mt-2">
              {busy && <Loader2 size={14} className="animate-spin" />}
              {tool.kind === "write" ? "Preview" : "Run"}
            </Button>
          </div>
        )}

        {/* Chat thread */}
        {hasHistory && (
          <>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} agent={agent} />
            ))}
            {(busy || planning) && (
              <ThinkingIndicator
                busy={busy}
                planning={planning}
                awaitingCommit={phase === PHASES.COMMITTING}
              />
            )}
          </>
        )}
      </div>

      {/* Input bar */}
      <form className="agent-input-bar" onSubmit={handleSend}>
        <Input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            awaitingConfirm
              ? "Confirm or cancel above first…"
              : "Ask anything or describe what you need"
          }
          disabled={busy || awaitingConfirm}
          aria-label="Ask the assistant"
          className="flex-1"
        />
        <Button
          type="submit"
          size="icon"
          disabled={busy || !question.trim() || awaitingConfirm}
          aria-label="Send"
        >
          {planning ? <Loader2 size={15} className="animate-spin" /> : <SendHorizontal size={15} />}
        </Button>
      </form>
    </aside>
  );
}
