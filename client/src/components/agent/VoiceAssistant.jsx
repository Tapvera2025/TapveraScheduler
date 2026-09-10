import { useCallback, useEffect, useRef } from "react";
import { Ear, Keyboard, Loader2, Mic, Volume2, X } from "lucide-react";
import VoiceMark from "./VoiceMark";
import { Button } from "../ui/Button";
import useAgent from "./useAgent";
import useVoice from "./useVoice";
import AgentResult from "./AgentResult";
import { speakableError, speakablePreview, speakableResult } from "./speakable";

/**
 * "Hey Tap" -> "Yes boss" -> a question -> an answer on screen and out loud.
 *
 * The voice layer only supplies words in and words out. What happens in between
 * is the same planner, the same gateway and the same confirmation step a typed
 * request goes through, so speaking cannot reach anything clicking could not.
 *
 * A change still has to be confirmed. It can be confirmed by saying "confirm",
 * but the button is always on screen too, because agreeing to something you
 * only heard is a worse decision than agreeing to something you can read.
 */

const YES = /\b(confirm|confirmed|yes|yep|go ahead|do it|create it)\b/i;
const NO = /\b(cancel|no|stop|never mind|nevermind|forget it)\b/i;

export default function VoiceAssistant({ onOpenPanel }) {
  const agent = useAgent();
  const { PHASES } = agent;
  const spokenRef = useRef("");
  const agentRef = useRef(agent);
  agentRef.current = agent;

  /** One spoken utterance in. Confirmation words are handled before planning. */
  const handleCommand = useCallback(
    (text) => {
      const current = agentRef.current;

      if (current.phase === PHASES.AWAITING_CONFIRMATION) {
        if (YES.test(text)) return current.confirm();
        if (NO.test(text)) return current.cancel();
        // Anything else during a confirmation is treated as a new request,
        // which cancels the pending change rather than half-applying it.
        current.cancel();
      }

      return current.ask(text);
    },
    [PHASES]
  );

  const voice = useVoice({ onCommand: handleCommand });

  // Say whatever just became true, once. The key stops a re-render from
  // repeating an answer that is already being read out.
  useEffect(() => {
    if (!voice.awake) return;

    let key = null;
    let text = "";
    let followUp = false;

    if (agent.phase === PHASES.AWAITING_CONFIRMATION && agent.draft) {
      key = `preview:${agent.draft.draftId}`;
      text = speakablePreview(agent.draft.preview);
      followUp = true;
    } else if (agent.phase === PHASES.DONE && agent.result) {
      key = `result:${agent.result.correlationId || agent.result.tool}`;
      text = speakableResult(agent.result);
    } else if (agent.error) {
      key = `error:${agent.error.code}:${agent.error.message}`;
      text = speakableError(agent.error);
      followUp = ["AMBIGUOUS_ENTITY", "INVALID_INPUT", "CONFLICT"].includes(agent.error.code);
    } else if (agent.assistantMessage && agent.phase === PHASES.IDLE) {
      key = `say:${agent.assistantMessage}`;
      text = agent.assistantMessage;
      followUp = true;
    }

    if (text && key !== spokenRef.current) {
      spokenRef.current = key;
      voice.settle(text, { followUp });
    }
  }, [
    voice,
    agent.phase,
    agent.draft,
    agent.result,
    agent.error,
    agent.assistantMessage,
    PHASES,
  ]);

  const busy = agent.phase === PHASES.RUNNING || agent.phase === PHASES.COMMITTING || agent.planning;
  // "In a conversation" - anything other than off or a passive wake watch.
  const busyTalking = voice.awake && voice.mode !== voice.MODES.WAKE;
  const showPopup =
    voice.awake && (voice.mode !== voice.MODES.WAKE || busy || agent.result || agent.draft || agent.error);

  const dismiss = () => {
    spokenRef.current = "";
    agent.reset();
    voice.stopConversation();
  };

  const stateLabel = {
    GREETING: "…",
    LISTENING: "Listening",
    THINKING: "Working on it",
    SPEAKING: "Speaking",
    WAKE: 'Say "Hey Tap"',
    OFF: "Click to talk",
  }[voice.mode];

  return (
    <>
      {/* The dock is the only always-on element: it says plainly whether the
          microphone is open, because an assistant that listens invisibly is
          not one people can consent to. */}
      <div className="voice-dock">
        {/* One control. Clicking it talks; the pill beside it decides whether
            "Hey Tap" keeps listening in the background. */}
        <button
          type="button"
          className={`voice-orb ${voice.awake ? "is-live" : ""} ${voice.listening ? "is-listening" : ""}`}
          onClick={busyTalking ? voice.disable : voice.startConversation}
          aria-label={busyTalking ? "Stop listening" : "Talk to the assistant"}
          title={busyTalking ? "Stop" : "Click and speak"}
        >
          <VoiceMark
            size={22}
            state={
              voice.mode === "SPEAKING"
                ? "speaking"
                : voice.mode === "THINKING"
                  ? "thinking"
                  : voice.listening
                    ? "listening"
                    : "idle"
            }
          />
        </button>

        <button
          type="button"
          className={`voice-wake-toggle ${voice.wakeEnabled ? "is-on" : ""}`}
          onClick={voice.wakeEnabled ? voice.disable : voice.enableWakeWord}
          title={voice.wakeEnabled ? 'Stop listening for "Hey Tap"' : 'Listen for "Hey Tap"'}
        >
          <Ear size={12} />
          Hey Tap
        </button>

        {(voice.awake || voice.wakeEnabled) && (
          <span className="voice-dock-label">{stateLabel}</span>
        )}
      </div>

      {voice.error && !voice.awake && <p className="voice-toast">{voice.error}</p>}

      {showPopup && (
        <div className="voice-overlay">
          <section className="voice-card" role="dialog" aria-live="polite" aria-label="Assistant">
            <header className="voice-card-head">
              <span className={`voice-state ${voice.listening ? "is-listening" : ""}`}>
                {voice.mode === "SPEAKING" ? <Volume2 size={14} /> : busy ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />}
                {stateLabel}
              </span>
              <div className="flex items-center gap-1">
                {onOpenPanel && (
                  <button
                    type="button"
                    className="voice-type-instead"
                    onClick={() => {
                      dismiss();
                      // Let the overlay unmount before the panel takes focus.
                      setTimeout(() => onOpenPanel(), 0);
                    }}
                    title="Type instead"
                  >
                    <Keyboard size={14} />
                    Type
                  </button>
                )}
                <button type="button" className="icon-button" onClick={dismiss} aria-label="Dismiss">
                  <X size={18} />
                </button>
              </div>
            </header>

            {voice.transcript && <p className="voice-transcript">“{voice.transcript}”</p>}

            {agent.assistantMessage && <p className="voice-said">{agent.assistantMessage}</p>}

            {agent.error && (
              <div className="voice-problem">
                <p>{agent.error.message}</p>
                {(agent.error.details?.candidates || []).length > 0 && (
                  <div className="voice-candidates">
                    {agent.error.details.candidates.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => agent.chooseCandidate(agent.error.details.entity, c)}
                      >
                        <strong>{c.name}</strong>
                        <span>{[c.position, c.department].filter(Boolean).join(" · ") || "—"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {agent.phase === PHASES.AWAITING_CONFIRMATION && agent.draft?.preview && (
              <div className="voice-preview">
                <h4>{agent.draft.preview.action}</h4>
                {/* Show whatever the preview actually contains, so a new
                    write tool does not silently render a blank card. */}
                <dl className="agent-facts">
                  {Object.entries(agent.draft.preview)
                    .filter(([k, v]) => k !== "action" && k !== "notes" && k !== "conflicts" && v !== null && v !== undefined && v !== "")
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>{k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                </dl>
                {agent.draft.preview.notes?.length > 0 && (
                  <ul className="agent-notes">
                    {agent.draft.preview.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                )}
                <div className="agent-confirm-row">
                  <Button onClick={agent.confirm} disabled={busy}>Confirm</Button>
                  <Button variant="outline" onClick={agent.cancel} disabled={busy}>Cancel</Button>
                </div>
                <p className="agent-provenance">
                  Say “confirm” or press the button · plan {agent.draft.integrityHash.slice(0, 12)}…
                </p>
              </div>
            )}

            {agent.phase === PHASES.DONE && agent.result && <AgentResult envelope={agent.result} />}
          </section>
        </div>
      )}
    </>
  );
}
