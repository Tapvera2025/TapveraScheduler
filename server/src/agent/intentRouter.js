/**
 * Fast deterministic intent router  (P2.1)
 *
 * Called after preResolve + normalizeText. Matches common patterns and routes
 * them directly to a tool WITHOUT calling the LLM.
 *
 * Returns { tool, input } on a match, or null to fall through to the planner.
 *
 * The read router fires for common read patterns. The write router fires ONLY
 * when every required field for a write is extracted with high confidence —
 * unambiguous verb, resolved entities, explicit date, explicit time range.
 * Anything less falls through to the LLM so parameter extraction is never
 * guessed.
 *
 * Extraction relies on annotations already in the text:
 *   preResolver  →  "…Archisman Dutta (employeeId: abc123…)"
 *   normalizer   →  "2026-09-18 (next Friday)" or "2026-09-15 to 2026-09-21 (next week)"
 */

const EMP_ID_RE  = /\(employeeId:\s*([a-f0-9]{24})\)/i;
const SITE_ID_RE = /\(siteId:\s*([a-f0-9]{24})\)/i;
const DATE_RANGE_RE = /(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/;
const DATE_SINGLE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;

// Write/mutating keywords — presence disables the read router.
const WRITE_RE = /\b(create|add|schedule|book|assign|register|update|edit|change|modify|cancel|delete|remove|undo|withdraw|move|swap|replace)\b/i;

// Verbs the createShift fast path will accept. Narrower than WRITE_RE on
// purpose — "move" and "swap" imply a lookup step we cannot do here.
const CREATE_SHIFT_VERB_RE = /\b(schedule|book|assign|roster|add\s+shift|create\s+shift|put\s+\S+\s+on)\b/i;

const CANCEL_SHIFT_VERB_RE = /\b(cancel|remove|delete)\s+(?:(?:the|a|this|that)\s+)?shift\b/i;

// A question about who is working, rather than who is employed. It has to beat
// the listEmployees pattern, because "all staff working today" matches both and
// the full staff list is not an answer to it.
const ROSTERED_RE = /\b(working|works|rostered|on\s+shift|on\s+duty|on\s+today|clocked\s+in)\b/i;

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

// ─── Time range parsing (createShift fast path) ────────────────────────────
//
// Accepts only unambiguous formats. If the user typed something we cannot
// parse deterministically we return null and the LLM handles it.
//
//   "09:00 to 17:00" / "9:00 – 17:00"  → { start: '09:00', end: '17:00' }
//   "09:00–17:00"                       → { start: '09:00', end: '17:00' } (normalizer output)
//   "9am to 5pm" / "9 am to 5 pm"       → { start: '09:00', end: '17:00' }
//   "9:30am to 5:15pm"                  → { start: '09:30', end: '17:15' }
//   "9 to 5"                            → null (ambiguous — could be 9am-5pm or 21:00-05:00)

const SEP = '(?:to|-|–|—)';
const HHMM_24_RE = new RegExp(
  `\\b(\\d{1,2}):(\\d{2})\\s*${SEP}\\s*(\\d{1,2}):(\\d{2})\\b`,
  'i'
);
const HHMM_12_RE = new RegExp(
  `\\b(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\s*${SEP}\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\b`,
  'i'
);
// Mixed: one side has am/pm, the other doesn't — still parseable.
//   "9 to 5pm"  → 09:00–17:00 (start inherits pm side's meridiem-adjacent logic → assume opposite)
//   "9am to 5"  → 09:00–17:00 (5 inherits pm since start is am and end is a lower number)
// To stay unambiguous we require BOTH sides carry am/pm or BOTH sides carry HH:mm.

const pad = (n) => String(n).padStart(2, '0');
const to24 = (h, m, meridiem) => {
  let hour = Number(h);
  if (hour < 1 || hour > 12) return null;
  const mer = meridiem.toLowerCase();
  if (mer === 'pm' && hour !== 12) hour += 12;
  if (mer === 'am' && hour === 12) hour = 0;
  return `${pad(hour)}:${pad(Number(m || 0))}`;
};
const valid24 = (h, m) => {
  const hh = Number(h);
  const mm = Number(m);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${pad(hh)}:${pad(mm)}`;
};

const parseTimeRange = (text) => {
  const twelve = text.match(HHMM_12_RE);
  if (twelve) {
    const [, sh, sm, sMer, eh, em, eMer] = twelve;
    const start = to24(sh, sm, sMer);
    const end   = to24(eh, em, eMer);
    if (start && end) return { start, end };
  }
  const twentyFour = text.match(HHMM_24_RE);
  if (twentyFour) {
    const [, sh, sm, eh, em] = twentyFour;
    const start = valid24(sh, sm);
    const end   = valid24(eh, em);
    if (start && end) return { start, end };
  }
  return null;
};

// ─── Read router ───────────────────────────────────────────────────────────

const routeRead = (text) => {
  if (WRITE_RE.test(text)) return null;

  const lower = text.toLowerCase();
  const ex = extract(text);

  // findEmployeeShifts — "shifts for archi", "archi's roster this week"
  if (ex.employeeId && /shifts?|roster|rota/i.test(lower)) {
    const input = { employeeId: ex.employeeId };
    if (ex.from) { input.from = ex.from; if (ex.to) input.to = ex.to; }
    // One date means that one day. Sending only `from` makes the tool apply its
    // own default end, which is thirteen days later — a fortnight in answer to
    // a question about tomorrow.
    else if (ex.date) { input.from = ex.date; input.to = ex.date; }
    return { tool: 'findEmployeeShifts', input };
  }

  // getDailySummary — "who is working today", "show today's roster"
  if (/who.{0,25}work|today.{0,20}roster|roster.{0,20}today|daily.{0,20}summ|show.{0,20}roster|today.{0,20}shifts?|who.{0,15}on.{0,15}today|on\s+shift.{0,15}today|staff.{0,20}roster.{0,15}today/i.test(lower)) {
    const input = {};
    if (ex.date) input.date = ex.date;
    else if (ex.from && !ex.to) input.date = ex.from;
    if (ex.siteId) input.siteId = ex.siteId;
    return { tool: 'getDailySummary', input };
  }

  // getDailySummary — "which staff are working today", "who is on shift
  // tomorrow". A rostered question with one resolved date is a daily summary
  // whatever noun it uses for the people.
  if (ROSTERED_RE.test(lower) && ex.date && !ex.from) {
    const input = { date: ex.date };
    if (ex.siteId) input.siteId = ex.siteId;
    return { tool: 'getDailySummary', input };
  }

  // listEmployees — "list employees", "show all staff", "how many employees"
  if (/\b(list|show|get|view|all|how many).{0,20}(employees?|staff|workers?|team)\b/i.test(lower)
      && !ex.employeeId
      && !ROSTERED_RE.test(lower)) {
    const input = {};
    if (ex.siteId) input.siteId = ex.siteId;
    return { tool: 'listEmployees', input };
  }

  // listSites — "what sites are available", "list all sites", "how many sites".
  //
  // Deliberately narrow: the site has to be the subject of the question, not
  // something mentioned in it. "show shifts at site 2" is a question about
  // shifts and must not land here.
  if (/^(?:what|which)\s+sites?\b/i.test(lower)
      || /\bsites?\s+(?:are\s+)?(?:available|there|set\s+up)\b/i.test(lower)
      || /\b(?:list|show|view|get)\s+(?:me\s+)?(?:the\s+|all\s+|our\s+)*sites?\b/i.test(lower)
      || /\bhow\s+many\s+sites?\b/i.test(lower)
      || /\bsite\s+list\b/i.test(lower)) {
    return { tool: 'listSites', input: {} };
  }

  // getAttendanceReport — "attendance for archi", "clock-in report for archi"
  if (ex.employeeId && /attendance|clock.{0,5}in|monthly.{0,10}report/i.test(lower)) {
    return { tool: 'getAttendanceReport', input: { employeeId: ex.employeeId } };
  }

  return null;
};

// ─── Write router ──────────────────────────────────────────────────────────
//
// Only createShift for now. Fires only when every required field is extracted
// unambiguously: employeeId, siteId, date, and an explicit time range. If any
// field is missing or the phrasing is fuzzy, returns null so the LLM handles
// it — the tradeoff is that we prefer a slightly slower correct write to a
// fast wrong one.

const routeWrite = (text) => {
  if (CANCEL_SHIFT_VERB_RE.test(text)) {
    const ex = extract(text);
    // Require employeeId annotation from preResolve and a single resolved date.
    // A date range means "cancel this whole week" — fall through to LLM.
    if (!ex.employeeId || !ex.date || ex.from) return null;
    return { tool: 'cancelShift', input: { employeeId: ex.employeeId, date: ex.date } };
  }

  if (!CREATE_SHIFT_VERB_RE.test(text)) return null;

  const ex = extract(text);
  if (!ex.employeeId) return null;
  if (!ex.siteId) return null;
  // Single date required — a range means "schedule this whole week", which the
  // fast path does not handle. Fall through to LLM.
  if (!ex.date || ex.from) return null;

  const time = parseTimeRange(text);
  if (!time) return null;

  // Reject obvious "cancel/remove/delete" combined phrasings even though the
  // verb regex above should already exclude them.
  if (/\b(cancel|delete|remove|drop)\b/i.test(text)) return null;

  return {
    tool: 'createShift',
    input: {
      employeeId: ex.employeeId,
      siteId: ex.siteId,
      date: ex.date,
      start: time.start,
      end: time.end,
    },
  };
};

/**
 * Words an utterance may contain and still name nobody and nowhere.
 *
 * Matching the intent pattern is not enough to call an utterance entity-free:
 * "list employees at Tapvera HQ" matches it and names a site. Skipping entity
 * resolution there drops the site filter silently and answers for the whole
 * organisation, which looks like a correct fast answer. So every word has to be
 * one we recognise; one unknown word means there may be a name in it, and the
 * resolver runs.
 *
 * Prepositions are safe to allow. It is the name after them that is unknown, so
 * "staff at Tapvera HQ" still falls through on "tapvera" — allowing "at" only
 * keeps the speed on the phrasings that name nothing.
 */
const ENTITY_FREE_WORDS = new Set([
  // question and command words
  'who', 'whos', 'is', 'are', 'was', 'were', 'am', 'be', 'been', 'do', 'does',
  'did', 'can', 'have', 'has', 'had', 'show', 'list', 'get', 'give', 'view',
  'tell', 'find', 'see', 'how', 'many', 'much', 'what', 'whats', 'when',
  'whens', 'which', 'please', 'me', 'us', 'i', 'we', 'you',
  // articles, filler and connectives
  'a', 'an', 'the', 'all', 'any', 'our', 'my', 'of', 'and', 'or', 'in', 'on',
  'to', 'at', 'for', 'from', 'by', 'with', 'about', 'it', 'that', 'this',
  'those', 'these', 'there', 'right', 'now', 'currently', 'just', 'today',
  'todays',
  // the nouns these patterns are about
  'employee', 'employees', 'staff', 'worker', 'workers', 'team', 'people',
  'person', 'roster', 'rostered', 'rota', 'shift', 'shifts', 'daily',
  'summary', 'schedule', 'work', 'works', 'working', 'duty', 'clocked',
  // dates and periods, which the normalizer resolves without the database
  'tomorrow', 'yesterday', 'tonight', 'this', 'next', 'last', 'week',
  'weekend', 'month', 'morning', 'afternoon', 'evening', 'night',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);

const isEntityFree = (text) => {
  const words = String(text).toLowerCase().match(/[a-z']+/g) || [];
  if (!words.length) return false;
  return words.every((w) => ENTITY_FREE_WORDS.has(w.replace(/'s$/, '').replace(/'/g, '')));
};

/**
 * Patterns that need no entity annotations (no employeeId, no siteId).
 * Called on raw text before preResolve so we can skip the DB call entirely.
 * Returns { tool, input } or null.
 */
const routeEntityFree = (text) => {
  if (WRITE_RE.test(text)) return null;
  if (!isEntityFree(text)) return null;
  const lower = text.toLowerCase();

  // getDailySummary — entity-free: any daily roster query without a named person
  if (/who.{0,25}work|today.{0,20}roster|roster.{0,20}today|daily.{0,20}summ|show.{0,20}roster|today.{0,20}shifts?|who.{0,15}on.{0,15}today|on\s+shift.{0,15}today|staff.{0,20}roster.{0,15}today/i.test(lower)) {
    return { tool: 'getDailySummary', input: {} };
  }

  // listEmployees — entity-free: any list/show employees query
  if (/\b(list|show|get|view|all|how many).{0,20}(employees?|staff|workers?|team)\b|\bemployee\s+list\b/i.test(lower)
      && !ROSTERED_RE.test(lower)) {
    return { tool: 'listEmployees', input: {} };
  }

  return null;
};

const route = (text) => routeWrite(text) || routeRead(text);

module.exports = { route, routeRead, routeWrite, routeEntityFree, isEntityFree, parseTimeRange };
