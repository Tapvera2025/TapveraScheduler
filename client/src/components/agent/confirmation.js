/**
 * The words that mean yes and no to a pending change.
 *
 * One definition, shared by the typed panel and the voice assistant, because
 * they were drifting apart: the typed side anchored the match to the whole
 * message, the spoken side looked for the word anywhere in it. That made
 * "yes but make it ten" commit the nine o'clock draft when spoken and reach
 * the planner when typed, and it made "no, schedule Ravi instead" cancel and
 * then throw the new instruction away.
 *
 * Anchoring is the safe choice. A bare yes or no is handled here; anything
 * carrying further instruction is not a bare answer, so it cancels the draft
 * and goes to the planner as a fresh request.
 *
 * Speech recognisers add their own punctuation and politeness, so a trailing
 * full stop and a trailing "please" are tolerated.
 */

const TAIL = "(?:\\s*,?\\s*(?:please|thanks|thank\\s+you))?\\s*[.!?]*";

export const CONFIRM_RE = new RegExp(
  `^(y|ye|yes|yeah|yep|yup|ok|okay|k|sure|confirm|confirmed|do\\s+it|go\\s+ahead|please\\s+do|proceed|create\\s+it|save\\s+it)${TAIL}$`,
  'i'
);

export const DENY_RE = new RegExp(
  `^(n|no|nope|nah|cancel|stop|abort|don'?t|do\\s+not|never\\s*mind|nevermind|scratch\\s+that|discard|forget\\s+it|leave\\s+it)${TAIL}$`,
  'i'
);
