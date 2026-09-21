import { useCallback, useEffect, useRef, useState } from "react";
import { Ear, Keyboard, Loader2, MessageSquare, Mic, Volume2, X } from "lucide-react";
import VoiceMark from "./VoiceMark";
import { Button } from "../ui/Button";
import useAgent from "./useAgent";
import useVoice from "./useVoice";
import AgentResult from "./AgentResult";
import { speakableChoice, speakableError, speakablePreview, speakableResult } from "./speakable";
import ChoiceList from "./ChoiceList";
import SiteLocationControl from "./SiteLocationControl";
import { CONFIRM_RE, DENY_RE } from "./confirmation";

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

export default function VoiceAssistant({ onOpenPanel }) {
  const agent = useAgent();
  const { PHASES } = agent;
  const spokenRef = useRef("");
  const agentRef = useRef(agent);
  agentRef.current = agent;
  // Lets handleCommand talk back. It is defined before useVoice runs, so the
  // speak function reaches it through a ref filled in by an effect below.
  const settleRef = useRef(null);

  /**
   * One spoken utterance in. A bare yes or no acts on the pending change; the
   * words are the same ones the typed panel accepts.
   *
   * Anything longer is a new request, even when it starts with "yes" or "no" —
   * "yes but make it ten" must not commit the nine o'clock draft, and "no,
   * schedule Ravi instead" must cancel and then do the scheduling rather than
   * cancelling and forgetting the rest of the sentence.
   */
  const handleCommand = useCallback(
    async (text) => {
      const current = agentRef.current;

      if (current.phase === PHASES.AWAITING_CONFIRMATION) {
        if (CONFIRM_RE.test(text)) return current.confirm();
        if (DENY_RE.test(text)) return current.cancel();
        // Anything else during a confirmation is treated as a new request,
        // which cancels the pending change rather than half-applying it.
        await current.cancel();
      }

      const accepted = await current.ask(text);
      if (accepted === false) {
        // The previous turn is still running, so this one was not taken. Say
        // so and listen again: dropping it in silence looks like the assistant
        // has stopped working.
        settleRef.current?.("One moment, I am still on the last one.", { followUp: true });
      }
      return accepted;
    },
    [PHASES]
  );

  const voice = useVoice({ onCommand: handleCommand });

  useEffect(() => {
    settleRef.current = voice.settle;
  }, [voice.settle]);

  // Say whatever just became true, once. The key stops a re-render from
  // repeating an answer that is already being read out.
  //
  // It is prefixed with the turn counter because the rest of the key is only
  // the content. Asking the same question twice, or being asked the same
  // missing-field question twice, produced the same key, so the second answer
  // was taken for a re-render and never spoken — and since a spoken answer is
  // what reopens the microphone, the assistant went quiet for good.
  useEffect(() => {
    if (!voice.awake) return;

    const turn = agent.outcomeId;
    let key = null;
    let text = "";
    let followUp = false;

    if (agent.phase === PHASES.AWAITING_CONFIRMATION && agent.draft) {
      key = `${turn}:preview:${agent.draft.draftId}`;
      text = speakablePreview(agent.draft.preview);
      followUp = true;
    } else if (agent.phase === PHASES.DONE && agent.result) {
      key = `${turn}:result:${agent.result.correlationId || agent.result.tool}`;
      text = speakableResult(agent.result);
    } else if (agent.error) {
      key = `${turn}:error:${agent.error.code}:${agent.error.message}`;
      text = speakableError(agent.error);
      followUp = ["AMBIGUOUS_ENTITY", "INVALID_INPUT", "CONFLICT"].includes(agent.error.code);
    } else if (agent.assistantMessage && agent.phase === PHASES.IDLE) {
      key = `${turn}:say:${agent.assistantMessage}`;
      // A question with options attached reads them out, because the person
      // asking by voice may not be looking at the screen at all.
      text = speakableChoice(agent.assistantMessage, agent.choice);
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
    agent.choice,
    agent.outcomeId,
    PHASES,
  ]);

  const busy = agent.phase === PHASES.RUNNING || agent.phase === PHASES.COMMITTING || agent.planning;
  // "In a conversation" - anything other than off or a passive wake watch.
  const busyTalking = voice.awake && voice.mode !== voice.MODES.WAKE;
  const showPopup =
    voice.awake && (voice.mode !== voice.MODES.WAKE || busy || agent.result || agent.draft || agent.error);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close the menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const dismiss = () => {
    spokenRef.current = "";
    agent.reset();
    voice.stopConversation();
  };

  const handleOrbClick = () => {
    if (busyTalking) {
      voice.disable();
    } else {
      setMenuOpen((v) => !v);
    }
  };

  const handleChatWithTap = () => {
    setMenuOpen(false);
    onOpenPanel?.();
  };

  const handleTalkWithTap = () => {
    setMenuOpen(false);
    voice.startConversation();
  };

  const stateLabel = {
    GREETING: "…",
    LISTENING: "Listening",
    THINKING: "Working on it",
    SPEAKING: "Speaking",
    WAKE: 'Click to automate',
    OFF: "Tap",
  }[voice.mode];

  return (
    <>
      {/* The dock is the only always-on element: it says plainly whether the
          microphone is open, because an assistant that listens invisibly is
          not one people can consent to. */}
      <div className="voice-dock" ref={menuRef}>
        <button
          type="button"
          className={`voice-orb ${voice.awake ? "is-live" : ""} ${voice.listening ? "is-listening" : ""}`}
          onClick={handleOrbClick}
          aria-label={busyTalking ? "Stop listening" : "Open assistant menu"}
          title={busyTalking ? "Stop" : "Tap assistant"}
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

        {/* Two-option menu: Chat or Talk */}
        {menuOpen && !busyTalking && (
          <div className="voice-menu" role="menu" aria-label="Assistant options">
            <button type="button" className="voice-menu-item" role="menuitem" onClick={handleChatWithTap}>
              <MessageSquare size={16} />
              <div className="voice-menu-text">
                <strong>Chat with Tap</strong>
                <span>Type commands to the assistant</span>
              </div>
            </button>
            <button type="button" className="voice-menu-item" role="menuitem" onClick={handleTalkWithTap}>
              <Mic size={16} />
              <div className="voice-menu-text">
                <strong>Talk with Tap</strong>
                <span>Use your voice to give commands</span>
              </div>
            </button>
          </div>
        )}

        <button
          type="button"
          className={`voice-wake-toggle ${voice.wakeEnabled ? "is-on" : ""}`}
          onClick={voice.wakeEnabled ? voice.disable : voice.enableWakeWord}
          title={voice.wakeEnabled ? 'Stop listening for "Hey Tap"' : 'Listen for "Hey Tap"'}
          aria-label={voice.wakeEnabled ? 'Stop listening for "Hey Tap"' : 'Listen for "Hey Tap"'}
        >
          <Ear size={12} />
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
              </div>
            )}

            {/* One picker for both shapes: an ambiguous name and a field the
                tool still needs. Tapping is always available, so a noisy room
                or a misheard site name is never a dead end. */}
            {agent.choice && (
              <ChoiceList
                entity={agent.choice.entity}
                candidates={agent.choice.candidates}
                truncated={agent.choice.truncated}
                label={agent.error ? "DID YOU MEAN" : "CHOOSE ONE"}
                disabled={busy}
                onChoose={agent.chooseCandidate}
              />
            )}

            {agent.phase === PHASES.AWAITING_CONFIRMATION && agent.draft?.preview && (
              <div className="voice-preview">
                <h4>{agent.draft.preview.action}</h4>
                {/* Show whatever the preview actually contains, so a new
                    write tool does not silently render a blank card. */}
                <dl className="agent-facts">
                  {Object.entries(agent.draft.preview)
                    .filter(([k, v]) =>
                      !["action", "notes", "conflicts", "geofence"].includes(k)
                      && v !== null && v !== undefined && v !== ""
                      && !(typeof v === "object" && !Array.isArray(v)))
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
                {/* A location cannot be spoken, so the map is always on screen
                    beside a spoken site preview. */}
                <SiteLocationControl
                  location={agent.draft.preview.location}
                  geofence={agent.draft.preview.geofence}
                  disabled={busy}
                  onSet={agent.revise}
                />
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
