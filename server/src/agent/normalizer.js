/**
 * Deterministic input normalizer  (P1.3 + P1.4)
 *
 * Resolves relative date and time expressions to ISO strings BEFORE the LLM
 * sees them. The LLM should receive "2026-09-18" not "next Friday". That is
 * a one-liner computation — there is no reason to spend tokens on it.
 *
 * P1.3  Dates — "today", "tomorrow", "Friday", "next Monday", "this weekend",
 *               "last week", "next month", etc. → YYYY-MM-DD or date range.
 *
 * P1.4  Time periods — "morning", "afternoon", "evening", "night" → explicit
 *               HH:mm–HH:mm ranges with business-defined boundaries.
 *               Compound forms handled first: "tomorrow morning",
 *               "next Friday evening".
 *
 * Replacement order matters: longest / most specific patterns run first so
 * "next Monday morning" is not split into "next Monday" + "morning".
 */

const { DateTime } = require('luxon');

// ─── Business-defined time periods (P1.4) ─────────────────────────────────
// Keys sorted longest-first so multi-word phrases match before single words.
const PERIODS = [
  ['early morning', '05:00', '08:00'],
  ['late night',    '22:00', '23:59'],
  ['morning',       '06:00', '12:00'],
  ['midday',        '11:30', '13:30'],
  ['noon',          '12:00', '13:00'],
  ['afternoon',     '12:00', '17:00'],
  ['evening',       '17:00', '21:00'],
  ['night',         '21:00', '23:59'],
];

// Build a regex alternation sorted by descending key length
const PERIOD_RE_SRC = PERIODS
  .map(([k]) => k.replace(/\s+/g, '\\s+'))
  .join('|');

const WEEKDAY_MAP = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5,  saturday: 6, sunday: 7,
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7,
};
const WEEKDAY_RE_SRC = Object.keys(WEEKDAY_MAP)
  .sort((a, b) => b.length - a.length)
  .join('|');

// ─── Helpers ───────────────────────────────────────────────────────────────

const fmtDate = (dt) => dt.toFormat('yyyy-MM-dd');
const fmtRange = (a, b, label) => `${fmtDate(a)} to ${fmtDate(b)} (${label})`;
const fmtPeriod = ([, start, end]) => `${start}–${end}`;

const lookupPeriod = (raw) => {
  const norm = raw.replace(/\s+/g, ' ').toLowerCase().trim();
  return PERIODS.find(([k]) => k === norm) || null;
};

/**
 * Resolve a weekday name to a DateTime given a modifier.
 *   next → next calendar occurrence (always ≥ 1 day ahead)
 *   last → most recent past occurrence
 *   this → this calendar week's occurrence
 *   bare → next upcoming (same as next)
 */
const resolveWeekday = (name, now, modifier) => {
  const target = WEEKDAY_MAP[name.toLowerCase()];
  if (!target) return null;

  if (modifier === 'last') {
    let d = now.minus({ days: 1 });
    while (d.weekday !== target) d = d.minus({ days: 1 });
    return d;
  }
  if (modifier === 'this') {
    return now.startOf('week').plus({ days: target - 1 });
  }
  // 'next' or bare — next upcoming occurrence, at least 1 day away
  let d = now.plus({ days: 1 });
  while (d.weekday !== target) d = d.plus({ days: 1 });
  // "next Monday" when today IS Monday → one full week forward
  if (modifier === 'next' && now.weekday === target) d = now.plus({ weeks: 1 });
  return d;
};

// ─── Main normalizer ───────────────────────────────────────────────────────

/**
 * Replace date/time expressions in `text` with deterministic ISO values.
 * Runs in the company's timezone.
 *
 * Labels (the human-readable originals in parentheses) are stored in a side
 * array and replaced with numeric placeholders during processing.  This stops
 * later rules from matching inside a label that an earlier rule produced.
 * Placeholders are restored to parenthetical form at the very end.
 */
const normalizeText = (text, timezone) => {
  const now = DateTime.now().setZone(timezone || 'UTC');
  let t = text;

  // Side-channel label store.  prot() saves the string and inlines a token
  // that contains only digits (word chars) so no \b boundary fires inside it.
  const vault = [];
  const prot  = (label) => { vault.push(label); return `�${vault.length - 1}�`; };
  const restore = (s) => s.replace(/�(\d+)�/g, (_, i) => `(${vault[Number(i)]})`);

  // ── 1. Compound: [modifier?] weekday + period ──────────────────────────
  // e.g. "next Friday evening", "tomorrow morning", "Monday afternoon"
  // Must run before any single-keyword rule so the full phrase is consumed.
  // (?:(mod)\s+)? consumes the modifier + its trailing space as a unit, so
  // when there is no modifier the match starts exactly at the day word and the
  // preceding space (part of the surrounding text) is not swallowed.
  const compound1 = new RegExp(
    `\\b(?:(next|this|last)\\s+)?(${WEEKDAY_RE_SRC}|tomorrow|today|yesterday)\\s+(${PERIOD_RE_SRC})\\b`,
    'gi'
  );
  t = t.replace(compound1, (match, mod, dayWord, periodWord) => {
    const period = lookupPeriod(periodWord);
    if (!period) return match;

    let date;
    const dw = dayWord.toLowerCase();
    if (dw === 'today')     date = now;
    else if (dw === 'tomorrow')  date = now.plus({ days: 1 });
    else if (dw === 'yesterday') date = now.minus({ days: 1 });
    else date = resolveWeekday(dw, now, mod?.toLowerCase());

    if (!date) return match;
    return `${fmtDate(date)} ${fmtPeriod(period)} ${prot(match.trim())}`;
  });

  // ── 2. "in N days / N days ago" ───────────────────────────────────────
  t = t.replace(/\bin\s+(\d+)\s+days?\b/gi, (m, n) =>
    `${fmtDate(now.plus({ days: +n }))} ${prot(m.trim())}`);
  t = t.replace(/\b(\d+)\s+days?\s+ago\b/gi, (m, n) =>
    `${fmtDate(now.minus({ days: +n }))} ${prot(m.trim())}`);

  // ── 3. Date ranges ─────────────────────────────────────────────────────
  // fmtRange labels (e.g. "next week", "this month") only contain stop-words
  // that are not re-matched by later rules, so no protection needed here.
  t = t.replace(/\bthis\s+weekend\b/gi, () => {
    const sat = now.startOf('week').plus({ days: 5 });
    return fmtRange(sat, sat.plus({ days: 1 }), 'this weekend');
  });
  t = t.replace(/\bnext\s+week\b/gi, () => {
    const mon = now.startOf('week').plus({ weeks: 1 });
    return fmtRange(mon, mon.plus({ days: 6 }), 'next week');
  });
  t = t.replace(/\bthis\s+week\b/gi, () => {
    const mon = now.startOf('week');
    return fmtRange(mon, mon.plus({ days: 6 }), 'this week');
  });
  t = t.replace(/\blast\s+week\b/gi, () => {
    const mon = now.startOf('week').minus({ weeks: 1 });
    return fmtRange(mon, mon.plus({ days: 6 }), 'last week');
  });
  t = t.replace(/\bnext\s+month\b/gi, () => {
    const nm = now.plus({ months: 1 });
    return fmtRange(nm.startOf('month'), nm.endOf('month'), 'next month');
  });
  t = t.replace(/\bthis\s+month\b/gi, () =>
    fmtRange(now.startOf('month'), now.endOf('month'), 'this month'));
  t = t.replace(/\blast\s+month\b/gi, () => {
    const lm = now.minus({ months: 1 });
    return fmtRange(lm.startOf('month'), lm.endOf('month'), 'last month');
  });

  // ── 4. Modified weekdays: "next/this/last Monday" ─────────────────────
  const modWeekday = new RegExp(
    `\\b(next|this|last)\\s+(${WEEKDAY_RE_SRC})\\b`, 'gi'
  );
  t = t.replace(modWeekday, (match, mod, day) => {
    const date = resolveWeekday(day, now, mod.toLowerCase());
    return date ? `${fmtDate(date)} ${prot(match.trim())}` : match;
  });

  // ── 5. Simple anchor dates ─────────────────────────────────────────────
  t = t.replace(/\btoday\b/gi,     () => `${fmtDate(now)} ${prot('today')}`);
  t = t.replace(/\btomorrow\b/gi,  () => `${fmtDate(now.plus({ days: 1 }))} ${prot('tomorrow')}`);
  t = t.replace(/\byesterday\b/gi, () => `${fmtDate(now.minus({ days: 1 }))} ${prot('yesterday')}`);

  // ── 6. Bare weekday names ──────────────────────────────────────────────
  const bareWeekday = new RegExp(`\\b(${WEEKDAY_RE_SRC})\\b`, 'gi');
  t = t.replace(bareWeekday, (match) => {
    const date = resolveWeekday(match, now, 'next');
    return date ? `${fmtDate(date)} ${prot(match.trim())}` : match;
  });

  // ── 7. Standalone time periods ─────────────────────────────────────────
  // Must run last — compound forms already consumed above
  const standaloneperiod = new RegExp(`\\b(${PERIOD_RE_SRC})\\b`, 'gi');
  t = t.replace(standaloneperiod, (match) => {
    const period = lookupPeriod(match);
    return period ? `${fmtPeriod(period)} ${prot(match.trim())}` : match;
  });

  return restore(t);
};

module.exports = { normalizeText };
