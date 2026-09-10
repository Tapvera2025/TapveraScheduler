import { useCallback, useEffect, useRef, useState } from "react";
import { agentApi } from "../../lib/api";

/**
 * Voice pipeline.
 *
 *   Mic → VAD → Whisper STT → preResolver (server) → LLM → TTS
 *
 * P0.1  Adaptive VAD replaces fixed silence timer. Calibrates noise floor for
 *       the first 250 ms, then ends capture 450 ms after speech energy drops
 *       below the floor. Target endpointing: 400–700 ms.
 *
 * P0.2  SpeechRecognition is gone from the listening path entirely.
 *       Whisper on Groq is the ONE authoritative STT source.
 *       SpeechRecognition is kept only for wake-word detection ("Hey Tap")
 *       because that is a simple English keyword match, not a transcription.
 *
 * P0.5  Every pipeline stage is timestamped. Timings are passed to the server
 *       on each transcription request so the full round-trip can be traced.
 */

const MODES = {
  OFF: "OFF",
  WAKE: "WAKE",
  GREETING: "GREETING",
  LISTENING: "LISTENING",
  THINKING: "THINKING",
  SPEAKING: "SPEAKING",
};

const WAKE_PATTERN = /\b(hey|hi|hay|ok|okay)\s*(tap|tab|top|tapp|tapped|taps)\b/i;
const WAKE_PREFERENCE = "roster-voice-wake";

// VAD constants (P0.1)
const VAD_CALIBRATION_MS = 250;   // time to measure ambient noise
const VAD_NOISE_MULTIPLIER = 3.5; // speech_threshold = noise_floor × this
const VAD_SILENCE_MULTIPLIER = 1.8; // silence_threshold = noise_floor × this
const VAD_SILENCE_MS = 450;       // ms of silence before endpointing
const VAD_MIN_SPEECH_MS = 200;    // ignore clips shorter than this
const VAD_MAX_CAPTURE_MS = 12000; // hard timeout

const getRecognition = () =>
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

const getSupportedMimeType = () => {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
};

// ─── Pipeline timestamp helper (P0.5) ─────────────────────────────────────────

const createPipelineLog = () => {
  const log = {};
  return {
    mark: (label) => { log[label] = Date.now(); },
    get: () => ({ ...log }),
    delta: (from, to) =>
      log[from] != null && log[to] != null ? log[to] - log[from] : null,
  };
};

export default function useVoice({ onCommand, greeting = "Yes boss" } = {}) {
  const Recognition = getRecognition();
  const supported =
    Boolean(Recognition) &&
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof MediaRecorder !== "undefined";

  const [mode, setMode] = useState(MODES.OFF);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState(null);
  const [pipelineTimes, setPipelineTimes] = useState(null);

  const recognitionRef = useRef(null);
  const modeRef = useRef(MODES.OFF);
  const suspendedRef = useRef(false);
  const runningRef = useRef(false);
  const wakeEnabledRef = useRef(false);
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const commandRef = useRef(onCommand);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const vadCleanupRef = useRef(null);
  const captureTimerRef = useRef(null);
  const transcribingRef = useRef(false);
  const pipelineRef = useRef(null);

  useEffect(() => { commandRef.current = onCommand; }, [onCommand]);

  const readStoredWake = () => {
    try { return localStorage.getItem(WAKE_PREFERENCE) === "on"; } catch { return false; }
  };

  const goTo = useCallback((next) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  // ─── Wake-word recognition (SpeechRecognition ONLY for "Hey Tap") ──────────

  const startRecognition = useCallback((attempt = 0) => {
    const r = recognitionRef.current;
    if (!r || suspendedRef.current || runningRef.current) return;
    try { r.start(); } catch {
      if (attempt < 3) setTimeout(() => startRecognition(attempt + 1), 250);
    }
  }, []);

  // ─── VAD + capture ─────────────────────────────────────────────────────────

  const stopCapture = useCallback(() => {
    clearTimeout(captureTimerRef.current);
    if (vadCleanupRef.current) { vadCleanupRef.current(); vadCleanupRef.current = null; }
    if (mediaRecorderRef.current?.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
  }, []);

  /**
   * P0.1: Adaptive VAD.
   *
   * Phase 1 — calibrate: measure ambient RMS for VAD_CALIBRATION_MS ms.
   * Phase 2 — listen: wait for energy to cross the speech threshold.
   * Phase 3 — endpoint: once speech has been detected, wait for energy to fall
   *            below the silence threshold for VAD_SILENCE_MS ms consecutively.
   *
   * Returns a cleanup function.
   */
  const startVAD = (analyser, onEndpoint) => {
    const buf = new Float32Array(analyser.fftSize);
    const rms = () => {
      analyser.getFloatTimeDomainData(buf);
      return Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    };

    // Phase 1: calibrate
    const samples = [];
    const calStart = Date.now();
    let phase = "calibrating";
    let hadSpeech = false;
    let speechStart = null;
    let silenceStart = null;
    let noiseFloor = 0.015; // default fallback

    const tick = setInterval(() => {
      const level = rms();

      if (phase === "calibrating") {
        samples.push(level);
        if (Date.now() - calStart >= VAD_CALIBRATION_MS) {
          noiseFloor = samples.length
            ? samples.reduce((a, b) => a + b) / samples.length
            : 0.015;
          phase = "listening";
        }
        return;
      }

      const speechThreshold = noiseFloor * VAD_NOISE_MULTIPLIER;
      const silenceThreshold = noiseFloor * VAD_SILENCE_MULTIPLIER;

      if (level > speechThreshold) {
        if (!hadSpeech) { hadSpeech = true; speechStart = Date.now(); }
        silenceStart = null;
      } else if (hadSpeech && level < silenceThreshold) {
        if (!silenceStart) silenceStart = Date.now();
        else if (Date.now() - silenceStart >= VAD_SILENCE_MS) {
          const speechDuration = Date.now() - (speechStart || 0);
          if (speechDuration >= VAD_MIN_SPEECH_MS) {
            clearInterval(tick);
            onEndpoint();
          } else {
            // Too short — reset and keep listening
            hadSpeech = false; speechStart = null; silenceStart = null;
          }
        }
      }
    }, 50);

    return () => clearInterval(tick);
  };

  const startWhisperCapture = useCallback(async () => {
    if (transcribingRef.current) return;

    // P0.5: pipeline timestamps
    const pipeline = createPipelineLog();
    pipelineRef.current = pipeline;
    pipeline.mark("record_start");

    audioChunksRef.current = [];
    setTranscript("🎙 Listening…");

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    } catch {
      setError("Microphone access was refused.");
      goTo(wakeEnabledRef.current ? MODES.WAKE : MODES.OFF);
      return;
    }

    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      pipeline.mark("record_stop");
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];

      if (!chunks.length || modeRef.current === MODES.OFF) {
        goTo(wakeEnabledRef.current ? MODES.WAKE : MODES.OFF);
        return;
      }

      transcribingRef.current = true;
      goTo(MODES.THINKING);
      setTranscript("Transcribing…");

      pipeline.mark("upload_start");
      const blob = new Blob(chunks, { type: mimeType || "audio/webm" });

      try {
        const res = await agentApi.transcribe(blob, pipeline.get());
        pipeline.mark("upload_end");

        const text = res.data?.text?.trim() || "";
        const serverPipeline = res.data?.pipeline || {};
        setPipelineTimes({ client: pipeline.get(), server: serverPipeline });

        if (text) {
          setTranscript(text);
          commandRef.current?.(text);
        } else {
          setTranscript("");
          goTo(wakeEnabledRef.current ? MODES.WAKE : MODES.OFF);
        }
      } catch {
        setError("Transcription failed. Try again or type instead.");
        goTo(wakeEnabledRef.current ? MODES.WAKE : MODES.OFF);
      } finally {
        transcribingRef.current = false;
      }
    };

    recorder.start(100);

    // P0.1: wire up adaptive VAD
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    const vadCleanup = startVAD(analyser, () => {
      ctx.close();
      pipeline.mark("vad_endpoint");
      stopCapture();
    });

    vadCleanupRef.current = () => { vadCleanup(); ctx.close(); };

    // Hard timeout
    captureTimerRef.current = setTimeout(() => {
      pipeline.mark("vad_timeout");
      stopCapture();
    }, VAD_MAX_CAPTURE_MS);
  }, [goTo, stopCapture]);

  // ─── Neural TTS (P0.4) ─────────────────────────────────────────────────────

  const speakNeural = useCallback(
    async (text, { thenListen = false } = {}) => {
      if (!text) return;

      suspendedRef.current = true;
      stopCapture();
      try { recognitionRef.current?.abort(); } catch {}

      goTo(MODES.SPEAKING);

      try {
        pipelineRef.current?.mark("tts_start");
        const res = await agentApi.tts(text);
        pipelineRef.current?.mark("tts_first_byte");

        const arrayBuffer = res.data;
        const audioCtx = new AudioContext();
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        const source = audioCtx.createBufferSource();
        source.buffer = decoded;
        source.connect(audioCtx.destination);

        await new Promise((resolve) => {
          source.onended = resolve;
          // Guard against onended never firing
          setTimeout(resolve, Math.max(3000, text.length * 80));
          source.start();
          pipelineRef.current?.mark("tts_end");
        });

        audioCtx.close();
      } catch {
        // Neural TTS unavailable — fall back to browser synthesis
        await speakBrowser(text);
      }

      suspendedRef.current = false;
      if (modeRef.current === MODES.OFF) return;

      if (thenListen) {
        setTranscript("");
        goTo(MODES.LISTENING);
        startWhisperCapture();
      } else if (wakeEnabledRef.current) {
        goTo(MODES.WAKE);
        startRecognition();
      } else {
        goTo(MODES.OFF);
      }
    },
    [goTo, startRecognition, startWhisperCapture, stopCapture]
  );

  // Browser TTS fallback (used when neural TTS is unavailable)
  const speakBrowser = (text) =>
    new Promise((resolve) => {
      if (!text) return resolve();
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const preferred = [
        (v) => /Samantha|Daniel|Karen|Moira/i.test(v.name),
        (v) => /natural|neural/i.test(v.name) && /en[-_]/i.test(v.lang),
        (v) => /enhanced/i.test(v.name) && /en[-_]/i.test(v.lang),
        (v) => /en[-_](AU|GB)/i.test(v.lang),
        (v) => /en[-_]/i.test(v.lang),
      ];
      for (const test of preferred) {
        const match = voices.find(test);
        if (match) { utterance.voice = match; break; }
      }
      utterance.rate = 1.02;
      utterance.pitch = 1;
      let settled = false;
      const once = () => { if (!settled) { settled = true; clearTimeout(guard); resolve(); } };
      utterance.onend = once;
      utterance.onerror = once;
      const guard = setTimeout(once, Math.max(2500, text.length * 90));
      window.speechSynthesis.speak(utterance);
    });

  const speak = speakNeural;

  // ─── SpeechRecognition — wake-word ONLY (P0.2) ─────────────────────────────

  useEffect(() => {
    if (!supported) return undefined;

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false; // P0.2: no interim results needed for wake-word
    recognition.lang = navigator.language || "en-US";
    recognitionRef.current = recognition;

    recognition.onstart = () => { runningRef.current = true; };

    recognition.onresult = (event) => {
      // P0.2: only process in WAKE mode — never in LISTENING
      if (modeRef.current !== MODES.WAKE) return;

      let heard = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        heard += event.results[i][0].transcript;
      }
      heard = heard.trim();
      if (!heard) return;

      const match = heard.match(WAKE_PATTERN);
      if (!match) return;

      const rest = heard
        .slice(match.index + match[0].length)
        .replace(/^[\s,.!?-]+/, "")
        .trim();

      if (rest.split(/\s+/).filter(Boolean).length >= 3) {
        goTo(MODES.THINKING);
        commandRef.current?.(rest);
        return;
      }

      goTo(MODES.GREETING);
      speak(greeting, { thenListen: true });
    };

    recognition.onend = () => {
      runningRef.current = false;
      if (modeRef.current === MODES.WAKE && !suspendedRef.current) {
        startRecognition();
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access was refused.");
        modeRef.current = MODES.OFF; setMode(MODES.OFF);
      }
    };

    return () => {
      modeRef.current = MODES.OFF;
      suspendedRef.current = true;
      stopCapture();
      try { recognition.abort(); } catch {}
      window.speechSynthesis?.cancel();
      recognitionRef.current = null;
    };
  }, [supported, Recognition, greeting, goTo, speak, startRecognition, stopCapture]);

  useEffect(() => {
    if (!navigator.permissions?.query) return;
    navigator.permissions.query({ name: "microphone" })
      .then((s) => s.onchange = () => {})
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!supported || !readStoredWake()) return;
    wakeEnabledRef.current = true;
    setWakeEnabled(true);
    suspendedRef.current = false;
    goTo(MODES.WAKE);
    startRecognition();
  }, [supported, goTo, startRecognition]);

  // ─── Public controls ───────────────────────────────────────────────────────

  const enableWakeWord = useCallback(() => {
    if (!supported) { setError("Chrome or Edge is required for voice."); return; }
    setError(null);
    wakeEnabledRef.current = true; setWakeEnabled(true);
    try { localStorage.setItem(WAKE_PREFERENCE, "on"); } catch {}
    suspendedRef.current = false;
    goTo(MODES.WAKE);
    startRecognition();
  }, [supported, goTo, startRecognition]);

  const startConversation = useCallback(() => {
    if (!supported) { setError("Chrome or Edge is required for voice."); return; }
    setError(null);
    if (!wakeEnabledRef.current) {
      wakeEnabledRef.current = true; setWakeEnabled(true);
      try { localStorage.setItem(WAKE_PREFERENCE, "on"); } catch {}
    }
    suspendedRef.current = false;
    goTo(MODES.GREETING);
    speak(greeting, { thenListen: true });
  }, [supported, goTo, speak, greeting]);

  const disable = useCallback(() => {
    stopCapture();
    wakeEnabledRef.current = false; setWakeEnabled(false);
    try { localStorage.setItem(WAKE_PREFERENCE, "off"); } catch {}
    suspendedRef.current = true;
    goTo(MODES.OFF);
    setTranscript("");
    try { recognitionRef.current?.abort(); } catch {}
    window.speechSynthesis?.cancel();
  }, [goTo, stopCapture]);

  const stopConversation = useCallback(() => {
    stopCapture();
    setTranscript("");
    window.speechSynthesis?.cancel();
    if (wakeEnabledRef.current) {
      suspendedRef.current = false;
      goTo(MODES.WAKE);
      startRecognition();
    } else {
      suspendedRef.current = true;
      goTo(MODES.OFF);
      try { recognitionRef.current?.abort(); } catch {}
    }
  }, [goTo, startRecognition, stopCapture]);

  const listenNow = useCallback(() => {
    if (!supported) return;
    setError(null);
    setTranscript("");
    suspendedRef.current = false;
    try { recognitionRef.current?.abort(); } catch {}
    goTo(MODES.LISTENING);
    startWhisperCapture();
  }, [supported, goTo, startWhisperCapture]);

  const settle = useCallback(
    (text, { followUp = false } = {}) => speak(text, { thenListen: followUp }),
    [speak]
  );

  return {
    MODES,
    supported,
    mode,
    wakeEnabled,
    listening: mode === MODES.LISTENING,
    awake: mode !== MODES.OFF,
    transcript,
    error,
    pipelineTimes,  // P0.5: expose for observability UI
    enableWakeWord,
    startConversation,
    disable,
    listenNow,
    stopConversation,
    speak,
    settle,
  };
}
