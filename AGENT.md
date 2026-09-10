# Operations Agent — Architecture & Technical Reference

## What It Does

A voice and text assistant built into the roster management platform. Administrators and managers can talk to it or type to it to query and manage their workforce — finding shifts, checking attendance, adding employees, cancelling shifts — without navigating the UI.

It works the same way whether you type or speak: the same security checks, the same database, the same confirmation step for any change.

---

## High-Level Architecture

```
User (voice or text)
        │
        ▼
┌───────────────────┐
│   STT Layer       │  Voice only
│   Groq Whisper    │  audio → text
│   + vocab prompt  │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Pre-Resolver     │  NEW
│  preResolver.js   │  "archi" → Archisman Dutta (employeeId: abc123)
│  + 60s cache      │  Runs against live DB before LLM sees anything
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  LLM Planner      │  Groq openai/gpt-oss-20b
│  planner.js       │  Picks ONE tool from the catalogue
│                   │  Receives clean, resolved entities — no raw names
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Gateway          │  gateway.js
│  Role check       │  Is this user allowed to call this tool?
│  Module check     │  Is this module enabled for their company?
│  Input sanitise   │  Strip reserved keys, validate types
└────────┬──────────┘
         │
    ┌────┴────┐
    │         │
  read      write
    │         │
    ▼         ▼
 execute   prepare → preview → human confirms → commit
    │
    ▼
┌───────────────────┐
│  Tool Handler     │  Typed, scoped, tenant-isolated DB operation
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  Voice Response   │  Voice only
│  speakable.js     │  Result → natural spoken sentence
│  Browser TTS      │  Text → audio output
└───────────────────┘
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| LLM Planner | Groq `openai/gpt-oss-20b` | Fast (~130ms), cheap, sufficient for 9-tool routing |
| STT (voice) | Groq `whisper-large-v3-turbo` | Fast transcription on Groq's LPU hardware |
| TTS (voice) | Browser `speechSynthesis` | No cost, no latency, offline |
| Wake word | Browser `SpeechRecognition` | "Hey Tap" detection, simple English keyword |
| Entity resolution | Custom `preResolver.js` | Typed DB lookup, not LLM guessing |
| API | OpenAI-compatible chat completions | Works with any OpenAI-compatible provider |

---

## The Pre-Resolver

**The single most important architectural decision.**

Most voice agents let the LLM handle name resolution — the user says "find shifts for Archi", the LLM tries to match "Archi" to someone. This fails because:
- STT mishears uncommon names ("Archisman" → "okkrishman")
- LLMs hallucinate or pick the wrong person

Our approach: resolve entities **before** the LLM sees the message.

```
User says:    "find shifts for archi"
Whisper:      "find shifts for archishman"   ← STT error
Pre-resolver: fuzzy match "archishman" against employee DB
              → Archisman Dutta (id: abc123)  ← exact DB record
LLM receives: "find shifts for Archisman Dutta (employeeId: abc123)"
LLM calls:    findEmployeeShifts({ employeeId: "abc123" })
              ← no name handling, just an ID
```

**How the matching works:**
1. Load all active employees and sites for the company (cached 60s)
2. Split the message into 1, 2 and 3-word phrases
3. For each phrase, compute normalised Levenshtein edit distance against all known names
4. If similarity ≥ 0.82 and unambiguous → replace with `Name (entityType: id)`
5. If two people match equally → don't resolve, let the ambiguity system ask

**What it covers:**
- First names: "Archi" → Archisman Dutta
- Full names: "Archisman Dutta" → exact match
- Sites: "tapvera" → Tapvera HQ
- Short codes: "TPV" → Tapvera HQ
- Emails: "archi@tapvera.io" → exact match on email field

---

## Voice Pipeline

### Input (speech → command)

```
1. Wake word detection
   Browser SpeechRecognition listens for "Hey Tap" in the background.
   Only used for keyword detection — not for actual command transcription.

2. Command capture
   On wake or button press, MediaRecorder records raw audio (WebM/Opus).
   AudioContext analyser measures RMS volume every 80ms.
   1.8 seconds of silence after speech → stop recording.

3. Transcription
   Audio sent to POST /api/agent/transcribe on the server.
   Server builds a vocabulary prompt: company name + all employee/site names
   in natural sentence context ("Staff: Archisman Dutta, ... Sites: Tapvera HQ")
   Groq Whisper transcribes with this prompt to bias toward known names.

4. Display (hybrid)
   SpeechRecognition also runs in parallel during capture, display-only.
   User sees approximate live text while speaking.
   Whisper's accurate result replaces it before submission.

5. Email normalisation
   "archi at tapvera dot io" → "archi@tapvera.io"

6. Pre-resolver
   Same entity resolution as the text path (see above).
```

### Output (result → speech)

```
speakable.js converts typed tool results into spoken sentences.
Numbers are read directly from result data — the LLM never narrates figures.
Browser speechSynthesis speaks the sentence.
Voice selection: prefers Samantha/Daniel (macOS), Natural/Neural (Windows),
Enhanced (Chrome), then best available English voice.
Microphone is muted while speaking to prevent feedback loops.
After speaking, microphone reopens automatically for follow-up.
```

---

## Available Tools

| Tool | Kind | What it does |
|---|---|---|
| `getDailySummary` | read | Who is rostered today (or any date), optionally filtered by site |
| `findEmployeeShifts` | read | All shifts for one employee over a date range |
| `getAttendanceReport` | read | Attendance, no-shows, late arrivals for an employee over a period |
| `listEmployees` | read | All active employees, optionally filtered by site |
| `createShift` | write | Add a shift for an employee at a site |
| `cancelShift` | write | Cancel an existing shift |
| `createEmployee` | write | Add a new employee record |
| `createClient` | write | Add a new client |
| `createSite` | write | Add a new site under a client |

Read tools execute immediately. Write tools go through a two-phase flow: **prepare** (returns a preview for human review) → **commit** (carries out the action only if the user confirms and echoes back the integrity hash).

---

## Security Model

- The API key never leaves the server
- Employee data is never sent to the LLM provider (only the admin's own words and tool schemas are sent)
- The LLM can only propose tools from the actor's own catalogue — a confused model cannot even name a tool the user isn't allowed to run
- Every tool call is re-validated at the gateway regardless of what the LLM said
- Write operations require human confirmation with an integrity hash that ties the confirmation to exactly the action that was previewed
- All queries are scoped to `companyId` — cross-tenant access is impossible at the model layer

---

## Configuration

Set in `server/.env`:

```
PLANNER_API_KEY=      # Groq API key (gsk_...)
PLANNER_BASE_URL=     # https://api.groq.com/openai/v1
PLANNER_MODEL=        # openai/gpt-oss-20b  (recommended)
```

The agent degrades gracefully without a key: the typed form still works, only free-text interpretation is disabled.

---

## Performance

| Step | Typical latency |
|---|---|
| Pre-resolver (cached) | ~1ms |
| Pre-resolver (cold, first call) | ~30ms (parallel with other queries) |
| Whisper STT (5s clip) | ~250ms |
| LLM planner (gpt-oss-20b) | ~130ms |
| Tool execution (DB query) | ~20–60ms |
| **Total text → response** | **~200ms** |
| **Total voice → response** | **~450ms** |

---

## Known Limitations

- Whisper struggles with uncommon proper nouns even with vocabulary prompting. The pre-resolver catches most of these via fuzzy matching, but very garbled transcriptions (edit distance > 4) may still slip through. Switching to `whisper-large-v3` (full model) improves this at the cost of ~0.3s extra latency.
- The wake word "Hey Tap" uses browser SpeechRecognition which is vendor-specific. Chrome sends audio to Google while listening.
- Browser TTS voice quality varies by OS. macOS Samantha/Daniel are natural; Windows voices vary by version.
