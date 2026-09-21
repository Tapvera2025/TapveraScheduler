/**
 * Values a person actually said, as opposed to values a model filled in.
 *
 * A tool that checks only that a required field is non-empty accepts "?" — and
 * "?" is what a language model writes when a field is marked REQUIRED and it
 * was never told the answer. The two-phase design then does its job perfectly
 * and presents a confirmable draft, leaving an admin one tap from a client
 * record called "?".
 *
 * So a required value that a person is supposed to have supplied has to look
 * like one. This is deliberately permissive about what a real name can be —
 * "3M", "H&M", "O'Brien & Sons" and non-Latin scripts all pass — and strict
 * only about the few shapes that carry no information at all.
 */

const { invalidInput } = require('./errors');

// Nothing on this list is a name anybody typed on purpose. Kept short: a
// false rejection blocks a real record, which is worse than letting an odd
// name through, so entries that could plausibly be a real business name
// (ABC, Sample, Foo) are deliberately absent.
const PLACEHOLDERS = new Set([
  'na', 'nil', 'null', 'none', 'undefined', 'unknown', 'unnamed', 'unspecified',
  'tbd', 'tba', 'todo', 'pending', 'blank', 'empty', 'missing', 'placeholder',
  'notspecified', 'notgiven', 'notprovided', 'notstated', 'string', 'name',
  'yourname', 'entername', 'somename', 'example', 'xxx', 'asdf', 'qwerty',
]);

// Any letter or digit in any script. "?" and "-" and "..." have none.
const HAS_MEANING = /[\p{L}\p{N}]/u;

const fold = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Does this value say anything, or is it a stand-in for an answer?
 * `nouns` are words naming the field itself, which a model sometimes echoes
 * back — "client" in answer to "what is the client called?".
 */
const isPlaceholder = (value, nouns = []) => {
  const text = String(value == null ? '' : value).trim();
  if (!HAS_MEANING.test(text)) return true;

  // Folding keeps only Latin letters and digits, so a name written in another
  // script folds away to nothing. It already has letters, and there is no
  // Latin placeholder it could be, so it stands.
  const folded = fold(text);
  if (!folded) return false;
  if (PLACEHOLDERS.has(folded)) return true;

  return nouns.some((noun) => {
    const n = fold(noun);
    if (!n) return false;
    return [n, `a${n}`, `an${n}`, `the${n}`, `new${n}`, `${n}name`, `name${n}`].includes(folded);
  });
};

/**
 * Return the trimmed value, or throw the question that should have been asked.
 *
 * The question carries INVALID_INPUT, so the client shows it as a prompt to
 * answer rather than an error to report — the same treatment every other
 * missing field gets.
 */
const requireStated = (value, { question, field, nouns = [] }) => {
  const text = value == null ? '' : String(value).trim();
  if (!text) throw invalidInput(question, { missing: [field] });
  if (isPlaceholder(text, nouns)) throw invalidInput(question, { missing: [field] });
  return text;
};

/**
 * A replacement value for a field on an existing record.
 *
 * Differs from requireStated in one way: leaving a field out means "do not
 * change this one", which is fine. Sending a placeholder is not — it would
 * overwrite a real name with "?", which is worse than creating a record with
 * one, because something correct is lost.
 *
 * Returns the trimmed value, or undefined when there is no change to make.
 */
const statedChange = (value, { question, field, nouns = [] }) => {
  const text = value == null ? '' : String(value).trim();
  if (!text) return undefined;
  if (isPlaceholder(text, nouns)) throw invalidInput(question, { missing: [field] });
  return text;
};

module.exports = { requireStated, statedChange, isPlaceholder, PLACEHOLDERS };
