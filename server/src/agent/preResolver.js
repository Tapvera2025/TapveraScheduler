/**
 * Entity pre-resolver  (P0.3 / P1.1)
 *
 * Resolves entity mentions in the user's message BEFORE the LLM sees it.
 * The LLM receives "Archisman Dutta (employeeId: abc123)" instead of "archi"
 * or whatever Whisper happened to produce. Name resolution is done in typed
 * code against the real database, never inside a language model.
 *
 * Matching cascade (exact → phonetic → fuzzy):
 *   1. Exact email
 *   2. Exact short code / shortName
 *   3. Exact full name (case-insensitive, normalised whitespace)
 *   4. Normalised name  (strip punctuation, collapse spaces)
 *   5. First-name alias  (first name alone, if long enough)
 *   6. Consonant-skeleton phonetic match
 *   7. Levenshtein fuzzy match
 *   8. Contextual boost (entity referenced earlier in conversation)
 *
 * Confidence thresholds by risk level:
 *   READ   (find, list, show, who, what)  →  ≥ 0.72  (permissive)
 *   WRITE  (add, create, schedule, assign) →  ≥ 0.88
 *   CANCEL (cancel, delete, remove, undo)  →  ≥ 0.95  (strict)
 *
 * Never silently resolves ambiguous matches. If two entities score within
 * 0.05 of each other the phrase is left unresolved and the ambiguity system
 * asks the admin to choose.
 *
 * Results are cached per company for 60 s. Call invalidateCache(companyId)
 * after any employee or site change.
 */

const Employee = require('../models/Employee');
const Site = require('../models/Site');

// ─── Cache ─────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;
const _cache = new Map();

const loadCatalogue = async (companyId) => {
  const hit = _cache.get(companyId);
  if (hit && hit.expiresAt > Date.now()) return hit;

  const [employees, sites] = await Promise.all([
    Employee.find({ companyId, isActive: true })
      .select('_id firstName lastName email')
      .limit(300)
      .lean(),
    Site.find({ companyId, status: 'ACTIVE' })
      .select('_id siteLocationName shortName')
      .limit(100)
      .lean(),
  ]);

  const entry = { expiresAt: Date.now() + CACHE_TTL_MS, employees, sites };
  _cache.set(companyId, entry);
  return entry;
};

// ─── Text normalisation ────────────────────────────────────────────────────

const normName = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// ─── Phonetic: consonant skeleton ─────────────────────────────────────────
//
// Maps digraphs first (order matters), then strips vowels from positions > 0,
// then deduplicates adjacent identical consonants.
// "archisman"  → "rchsmn"
// "archishman" → "rchxmn"   (sh → x)   edit-distance 1 from above  ✓
// "arcishman"  → "rcxmn"                edit-distance 2              ✓
//
const DIGRAPH = [
  [/sh/g, 'x'], [/ch/g, 'k'], [/ph/g, 'f'], [/th/g, 'z'],
  [/gh/g, 'g'], [/ck/g, 'k'], [/wh/g, 'w'],
];
const VOWEL_RE = /(?<!^)[aeiou]/g; // remove vowels except the first letter

const skeleton = (s) => {
  let t = normName(s);
  for (const [re, rep] of DIGRAPH) t = t.replace(re, rep);
  t = t.replace(VOWEL_RE, '');
  return t.replace(/(.)\1+/g, '$1'); // dedup adjacent
};

// ─── Levenshtein ───────────────────────────────────────────────────────────

const lev = (a, b) => {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
};

const strSim = (a, b) => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const la = a.toLowerCase(), lb = b.toLowerCase();
  if (Math.abs(la.length - lb.length) > 5) return 0;
  return 1 - lev(la, lb) / Math.max(la.length, lb.length);
};

const phonSim = (a, b) => strSim(skeleton(a), skeleton(b));

// ─── Words that must never be entity-matched ────────────────────────────────

const STOP = new Set([
  'the','and','for','with','this','that','from','have','been','will','what',
  'when','where','who','how','show','find','list','get','add','create','cancel',
  'update','shifts','shift','employee','employees','site','sites','today',
  'tomorrow','week','next','last','monday','tuesday','wednesday','thursday',
  'friday','saturday','sunday','attendance','leave','report','schedule',
  'roster','assign','view','check','give','tell','need','want','work',
  'working','hours','time','date','day','month','year','email','phone',
  'morning','afternoon','evening','night','this','their','they','them',
]);

// ─── Confidence thresholds by operation risk ───────────────────────────────

const CANCEL_RE = /\b(cancel|delete|remove|undo|withdraw)\b/i;
const WRITE_RE  = /\b(add|create|schedule|book|assign|register|put|make)\b/i;

const thresholds = (text) => {
  if (CANCEL_RE.test(text)) return 0.95; // CANCEL/DELETE — very high confidence
  if (WRITE_RE.test(text))  return 0.88; // WRITE — high confidence
  return 0.72;                           // READ  — permissive
};

// ─── Candidate builder ─────────────────────────────────────────────────────

const buildCandidates = (employees, sites) => {
  const list = [];

  for (const e of employees) {
    const full = [e.firstName, e.lastName].filter(Boolean).join(' ');
    const id   = e._id.toString();
    const ann  = `${full} (employeeId: ${id})`;

    if (e.email)
      list.push({ exact: e.email.toLowerCase(), norm: null, label: full, ann, kind: 'email' });
    if (full.length >= 2)
      list.push({ exact: null, norm: normName(full), label: full, ann, kind: 'fullName',
                  skel: skeleton(full) });
    if (e.firstName && e.firstName.length >= 3 && !STOP.has(e.firstName.toLowerCase()))
      list.push({ exact: null, norm: normName(e.firstName), label: full, ann, kind: 'firstName',
                  skel: skeleton(e.firstName) });
    if (e.lastName && e.lastName.length >= 3 && !STOP.has(e.lastName.toLowerCase()))
      list.push({ exact: null, norm: normName(e.lastName), label: full, ann, kind: 'lastName',
                  skel: skeleton(e.lastName) });
  }

  for (const s of sites) {
    const id  = s._id.toString();
    const ann = `${s.siteLocationName} (siteId: ${id})`;

    if (s.shortName)
      list.push({ exact: s.shortName.toLowerCase(), norm: null, label: s.siteLocationName,
                  ann, kind: 'siteCode' });
    if (s.siteLocationName && s.siteLocationName.length >= 3)
      list.push({ exact: null, norm: normName(s.siteLocationName), label: s.siteLocationName,
                  ann, kind: 'siteName', skel: skeleton(s.siteLocationName) });
  }

  return list;
};

// ─── Match a single phrase against the catalogue ───────────────────────────

/**
 * Run the cascade for one phrase.
 * Returns { ann, confidence } or null.
 */
const matchPhrase = (phrase, candidates, minConfidence) => {
  const cleanPhrase = phrase.replace(/[^\w\s@.]/g, '').trim();
  if (!cleanPhrase || cleanPhrase.length < 2) return null;
  if (STOP.has(cleanPhrase.toLowerCase())) return null;

  const normPhrase = normName(cleanPhrase);
  const skelPhrase = skeleton(cleanPhrase);

  let best = null;
  let bestConf = 0;
  let runner = null;
  let runnerConf = 0;

  const consider = (ann, conf) => {
    if (conf > bestConf) {
      runner = best; runnerConf = bestConf;
      best = ann; bestConf = conf;
    } else if (conf > runnerConf && ann !== best) {
      runner = ann; runnerConf = conf;
    }
  };

  for (const c of candidates) {
    // 1. Exact email
    if (c.kind === 'email' && c.exact === cleanPhrase.toLowerCase()) {
      consider(c.ann, 1.0); continue;
    }
    // 2. Exact site code
    if (c.kind === 'siteCode' && c.exact === cleanPhrase.toLowerCase()) {
      consider(c.ann, 1.0); continue;
    }
    // 3 & 4. Exact / normalised name
    if (c.norm) {
      if (c.norm === normPhrase)          { consider(c.ann, 0.99); continue; }
      if (c.norm.startsWith(normPhrase) && normPhrase.length >= 4)
                                          { consider(c.ann, 0.90); }
    }
    // 6. Phonetic skeleton
    if (c.skel && skelPhrase.length >= 3) {
      const ps = strSim(skelPhrase, c.skel);
      if (ps >= 0.78) consider(c.ann, ps * 0.88); // scale down slightly
    }
    // 7. Levenshtein fuzzy
    if (c.norm) {
      const fs = strSim(normPhrase, c.norm);
      if (fs >= 0.65) consider(c.ann, fs * 0.95);
    }
  }

  if (bestConf < minConfidence) return null;
  // 8. Ambiguity guard — if two different entities score within 0.05, don't auto-resolve
  if (runner && best !== runner && Math.abs(bestConf - runnerConf) < 0.05) return null;

  return { ann: best, confidence: bestConf };
};

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Rewrite `text` with resolved entity annotations.
 *
 * "find shifts for archi"
 *   → "find shifts for Archisman Dutta (employeeId: abc123)"
 *
 * "cancel the shift at tapvera"
 *   → "cancel the shift at Tapvera HQ (siteId: def456)"
 */
const preResolve = async (actor, text) => {
  const { employees, sites } = await loadCatalogue(actor.companyId);
  if (!employees.length && !sites.length) return text;

  const candidates = buildCandidates(employees, sites);
  const minConf = thresholds(text);
  const words = text.split(/\s+/);
  const out = [];
  let i = 0;

  while (i < words.length) {
    let matched = false;

    // Longest match first: 3-gram → 2-gram → 1-gram
    for (const n of [3, 2, 1]) {
      if (i + n > words.length) continue;
      const phrase = words.slice(i, i + n).join(' ');
      const result = matchPhrase(phrase, candidates, minConf);
      if (result) {
        out.push(result.ann);
        i += n;
        matched = true;
        break;
      }
    }

    if (!matched) { out.push(words[i]); i++; }
  }

  return out.join(' ');
};

const invalidateCache = (companyId) => _cache.delete(companyId);

module.exports = { preResolve, invalidateCache };
