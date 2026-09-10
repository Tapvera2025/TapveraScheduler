/**
 * Fast deterministic intent router  (P2.1)
 *
 * Called after preResolve + normalizeText. Matches common read-only patterns
 * and routes them directly to a tool WITHOUT calling the LLM.
 *
 * Returns { tool, input } on a match, or null to fall through to the planner.
 *
 * Only routes reads — writes always go through the LLM so parameter
 * extraction is never guessed by a regex.
 *
 * Extraction relies on annotations already in the text:
 *   preResolver  →  "…Archisman Dutta (employeeId: abc123…)"
 *   normalizer   →  "2026-09-18 (next Friday)" or "2026-09-15 to 2026-09-21 (next week)"
 */

const EMP_ID_RE  = /\(employeeId:\s*([a-f0-9]{24})\)/i;
const SITE_ID_RE = /\(siteId:\s*([a-f0-9]{24})\)/i;
const DATE_RANGE_RE = /(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/;
const DATE_SINGLE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;

// Any of these words in the message means it is likely a write → send to LLM
const WRITE_RE = /\b(create|add|schedule|book|assign|register|update|edit|change|modify|cancel|delete|remove|undo|withdraw|move|swap|replace)\b/i;

const extract = (text) => {
  const empMatch   = text.match(EMP_ID_RE);
  const siteMatch  = text.match(SITE_ID_RE);
  const rangeMatch = text.match(DATE_RANGE_RE);
  const dateMatch  = rangeMatch ? null : text.match(DATE_SINGLE_RE);
  return {
    employeeId: empMatch?.[1]  || null,
    siteId:     siteMatch?.[1] || null,
    from:       rangeMatch?.[1] || null,
    to:         rangeMatch?.[2] || null,
    date:       dateMatch?.[1]  || null,
  };
};

/**
 * Route `text` (already pre-resolved and date-normalized) to a tool, or null.
 */
const route = (text) => {
  // Never guess intent for messages that contain write/mutating keywords.
  if (WRITE_RE.test(text)) return null;

  const lower = text.toLowerCase();
  const ex = extract(text);

  // ── findEmployeeShifts ────────────────────────────────────────────────────
  // Matches: "shifts for archi", "what's archi on this week", "[employee] roster"
  if (ex.employeeId && /shifts?|roster|rota/i.test(lower)) {
    const input = { employeeId: ex.employeeId };
    if (ex.from) { input.from = ex.from; if (ex.to) input.to = ex.to; }
    else if (ex.date) input.from = ex.date;
    return { tool: 'findEmployeeShifts', input };
  }

  // ── getDailySummary ───────────────────────────────────────────────────────
  // Matches: "who is working today", "show today's roster", "daily summary"
  if (/who.{0,25}work|today.{0,20}roster|roster.{0,20}today|daily.{0,20}summ|show.{0,20}roster/i.test(lower)) {
    const input = {};
    if (ex.date) input.date = ex.date;
    else if (ex.from && !ex.to) input.date = ex.from;
    if (ex.siteId) input.siteId = ex.siteId;
    return { tool: 'getDailySummary', input };
  }

  // ── listEmployees ─────────────────────────────────────────────────────────
  // Matches: "list employees", "show all staff", "how many employees"
  if (/\b(list|show|get|view|all|how many).{0,20}(employees?|staff|workers?|team)\b/i.test(lower)
      && !ex.employeeId) {
    const input = {};
    if (ex.siteId) input.siteId = ex.siteId;
    return { tool: 'listEmployees', input };
  }

  return null;
};

module.exports = { route };
