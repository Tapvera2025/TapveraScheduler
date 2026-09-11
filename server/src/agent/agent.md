# Agent architecture

The agent is closer to Siri + Spotlight + an operations console than a chatbot.
Its job is to turn one utterance (typed or spoken) into one previewed or
executed action, and to do it fast enough that the person does not wait.

## Design principle

**Do not try to make the AI faster. Make fewer interactions require AI.**

Common manager commands take a deterministic fast path. The LLM handles the
genuinely ambiguous or complex cases. Target split: 70–90% fast path, 10–30%
LLM.

## Pipeline

```
                     USER
                       │
             ┌─────────┴─────────┐
             │                   │
           TEXT                VOICE
             │                   │
             │             Streaming STT
             │                   │
             └─────────┬─────────┘
                       ▼
              INPUT NORMALIZER
                       │
                       ▼
          ENTITY / TEMPORAL RESOLVER
              (preResolver + normalizer)
                       │
                       ▼
             FAST INTENT ROUTER
                       │
              matched?
              ┌────┴────┐
             YES        NO
              │          │
              │      LLM PLANNER (GPT → Grok)
              │          │
              └────┬─────┘
                   ▼
              ORCHESTRATOR (gateway)
                   │
             ┌─────┼─────┐
           auth policies conflicts
             │     │     │
             └─────┼─────┘
                   ▼
                TOOL / DB
                   │
           ┌───────┴───────┐
          READ            WRITE
           │               │
     result envelope   draft + preview
                           │
                        confirm
                           │
                         commit
                   │
                   ▼
         UI ACTION CARD + TTS
```

## Performance budgets

These are the numbers we optimize against. Each stage records its duration in
the `pipeline` field of the plan response; the client can enforce them.

### Text read command

| Stage                     | Budget          |
| ------------------------- | --------------- |
| UI acknowledgement        | < 100 ms        |
| Entity resolution         | < 30 ms p95 (cached) |
| Intent routing            | < 150 ms p95    |
| DB execution              | < 100 ms p95    |
| Useful UI visible         | < 500 ms p50, < 1 s p95 |

### Voice command

| Stage                     | Budget          |
| ------------------------- | --------------- |
| Speech endpoint (VAD)     | < 700 ms typical |
| Final STT                 | < 300 ms after endpoint |
| Planning                  | < 200 ms (fast) / < 1 s (LLM) |
| Tool execution            | < 100 ms        |
| First response UI         | < 1.2 s after speech |
| First TTS audio           | < 1.5 s after speech |

### Perceived latency ceiling

For all common commands: **< 500 ms p50, < 1 s p95 to useful UI**.
If the p95 breaches for a week, that command belongs on the fast path.

## Fast path

`intentRouter.js` exports `route(text)` which is called after `preResolve` +
`normalizeText`. It returns `{ tool, input }` on a high-confidence match or
`null` to fall through to the LLM.

**Reads currently on the fast path:**
- `findEmployeeShifts` — "shifts for archi", "archi's roster this week"
- `getDailySummary` — "who is working today", "show today's roster"
- `listEmployees` — "list employees", "show all staff"

**Writes currently on the fast path:**
- `createShift` — only when employeeId + siteId + date + explicit time range
  are all extracted unambiguously.

The write router intentionally refuses to fire on anything ambiguous. A slow
correct write beats a fast wrong one. If in doubt, return null.

## What NEVER goes through the LLM

- **Response narration.** `speakable.js` renders tool results deterministically.
  Numbers come from typed code, not the model.
- **Entity resolution.** `preResolver.js` handles name/site matching in typed
  code against the real DB. The LLM sees `Archisman Dutta (employeeId: abc)`,
  not `archi`.
- **Date/time normalization.** `normalizer.js` resolves "next Friday" to
  `2026-09-18` before the model sees it.
- **Confirmation.** When a draft is on-screen, "yes"/"no" is intercepted
  client-side (`useAgent.js`) and goes straight to `/commit` or `/cancel`.
  No planner turn.

## Two-phase writes

Every write is `prepare → commit`. `prepare` resolves, validates, builds a
draft with an integrity hash, and returns a preview. `commit` re-derives the
world (which may have moved), refuses if the plan drifted, and only then
writes. This gives us:

- Human-in-the-loop review by default
- Idempotency: committing the same draft twice replays the first outcome
- Safety: the LLM cannot silently escalate a read into a write

## Instrumentation

Every plan call returns:

```json
{
  "pipeline": {
    "resolveMs": 12,
    "normalizeMs": 3,
    "routeMs": 1,
    "plannerMs": 0,
    "totalMs": 16,
    "path": "fast" | "llm"
  }
}
```

`path: "fast"` means we skipped the LLM. Aggregate `totalMs` by `path` to see
how much of the traffic each channel serves.
