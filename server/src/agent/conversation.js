/**
 * Small, deterministic helpers for continuing an unfinished chat operation.
 * Context is only a proposed tool input; the gateway still authorises and
 * validates every operation before preparing a draft.
 */

const MAX_INPUT_LENGTH = 200;
const RESERVED_KEYS = new Set([
  'companyId', 'company', 'userId', 'actorId', 'role', 'roles', 'tenant',
  'tenantId', 'limit', 'skip', 'query', 'filter', 'projection', 'pipeline',
  'url', 'code', '__proto__', 'prototype', 'constructor',
]);

const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);

const cleanValue = (value) => {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
    return null;
  }
  const text = String(value).trim();
  return text && text.length <= MAX_INPUT_LENGTH ? text : null;
};

const cleanInput = (input, allowed) => {
  const clean = {};
  if (!isRecord(input)) return clean;
  for (const [key, value] of Object.entries(input)) {
    if (RESERVED_KEYS.has(key) || (allowed && !allowed.has(key))) continue;
    const text = cleanValue(value);
    if (text !== null) clean[key] = text;
  }
  return clean;
};

const sanitiseContext = (context, tools) => {
  if (!isRecord(context) || typeof context.tool !== 'string' || !Array.isArray(tools)) {
    return null;
  }
  const tool = tools.find((entry) => entry?.function?.name === context.tool);
  if (!tool) return null;
  const properties = tool.function.parameters?.properties || {};
  const allowed = new Set(Object.keys(properties).filter((key) =>
    ['string', 'number', 'integer'].includes(properties[key]?.type)
  ));
  // Which field the tool last asked for. Only a real field of this tool
  // counts, so nothing the browser sends can widen what may be written.
  const awaiting =
    typeof context.awaiting === 'string' && allowed.has(context.awaiting)
      ? context.awaiting
      : null;
  return { tool: context.tool, input: cleanInput(context.input, allowed), awaiting };
};

/** A corrected reference must not leave an earlier id/name taking precedence. */
const mergeInput = (previousInput, nextInput) => {
  const previous = cleanInput(previousInput);
  const next = cleanInput(nextInput);
  const merged = { ...previous, ...next };

  for (const entity of ['employee', 'site', 'client', 'shift']) {
    const nameKey = `${entity}Name`;
    const idKey = `${entity}Id`;
    if (next[nameKey] && next[nameKey] !== previous[nameKey]
        && (!next[idKey] || next[idKey] === previous[idKey])) {
      delete merged[idKey];
    }
    if (next[idKey] && next[idKey] !== previous[idKey]
        && (!next[nameKey] || next[nameKey] === previous[nameKey])) {
      delete merged[nameKey];
    }
  }

  return merged;
};

const PREFIX = /^(?:(?:please|now|actually|instead|okay|ok)\b[\s,:]*|(?:can|could|would|will)\s+you\s+|(?:i\s+(?:want|need|would\s+like)|i'd\s+like)\s+to\s+|(?:let's|let\s+us)\s+)/i;
const ARTICLE = '(?:(?:a|an|the|new|another|one|this|that)\\s+)*';
const EMPLOYEE = '(?:employees?|people|person|staff(?:\\s+member)?|workers?)\\b';
const ENTITIES = [
  [EMPLOYEE, 'Employee'],
  ['clients?\\b', 'Client'],
  ['sites?\\b', 'Site'],
  ['shifts?\\b', 'Shift'],
];

const removePrefix = (text) => {
  let result = text.trim();
  while (PREFIX.test(result)) result = result.replace(PREFIX, '').trim();
  return result;
};

const classifyCommand = (raw) => {
  const text = removePrefix(raw);

  for (const [entity, suffix] of ENTITIES) {
    if (new RegExp(`^(?:add|create|register)\\s+${ARTICLE}${entity}`, 'i').test(text)) {
      return `create${suffix}`;
    }
    if (new RegExp(`^(?:update|edit|change|modify)\\s+${ARTICLE}${entity}`, 'i').test(text)) {
      return `update${suffix}`;
    }
  }

  if (new RegExp(`^(?:cancel|remove|delete)\\s+${ARTICLE}shifts?\\b`, 'i').test(text)) {
    return 'cancelShift';
  }
  if (new RegExp(`^deactivate\\s+${ARTICLE}${EMPLOYEE}`, 'i').test(text)) {
    return 'deactivateEmployee';
  }

  // These verbs describe shift assignment, but a noun-only answer such as
  // "Shift Supervisor" or "Roster Manager" never selects an operation.
  if (new RegExp(`^(?:schedule|book|assign)\\s+${ARTICLE}shifts?\\b`, 'i').test(text)
      || /^(?:schedule|assign|roster)\s+\S+(?:\s+\S+){0,5}\s+(?:at|on|for|to)\s+\S+/i.test(text)
      || /^put\s+\S+(?:\s+\S+){0,5}\s+on\s+(?:a\s+|the\s+)?shift\b/i.test(text)) {
    return 'createShift';
  }

  if (/^who\s+(?:is|are|will\s+be)\s+(?:working|on\s+(?:a\s+)?shift)\b/i.test(text)) {
    return 'getDailySummary';
  }
  if (/^how\s+many\s+(?:employees?|staff|workers?)\b/i.test(text)) return 'listEmployees';

  const read = text.match(/^(?:show|check|view|get|list|find)\s+(?:me\s+)?(?:(?:the|all|our)\s+)*(.*)$/i);
  if (!read) return null;
  const subject = read[1];
  if (/^(?:employees?|staff|workers?|team)\b/i.test(subject)) return 'listEmployees';
  if (/^(?:attendance|clock[ -]?in(?:\s+report)?|monthly\s+attendance\s+report)\b/i.test(subject)) {
    return 'getAttendanceReport';
  }
  // A date in front of "roster" is a date, not a person. Without this guard
  // "today's roster" matches the possessive-name pattern below and the request
  // is read as one employee's roster, which then asks for an employee name.
  const DATE_SUBJECT = /^(?:today|tomorrow|yesterday|this|next|last|\d{4}-\d{2}-\d{2})\b/i;

  if (/^(?:shifts?|rota)\b/i.test(subject)
      || (/^.{1,80}['’]s\s+(?:shifts?|roster|rota)\b/i.test(subject) && !DATE_SUBJECT.test(subject))
      || /^roster\s+for\s+(?!today\b|tomorrow\b|yesterday\b|this\b|next\b|last\b|\d{4}-\d{2}-\d{2}\b)\S+/i.test(subject)) {
    return 'findEmployeeShifts';
  }
  if (/^(?:(?:today|tomorrow|yesterday)['’]?s?\s+)?roster\b|^daily\s+summary\b/i.test(subject)) {
    return 'getDailySummary';
  }
  return null;
};

/**
 * Is this only the command, with nothing else in it?
 *
 * "add a site" says what to do and carries no detail, so there is nothing for
 * the planner to extract. Running the tool with no input instead lets the tool
 * ask for its own first field, which is what makes the answer to that question
 * land somewhere known.
 */
const isBareCommand = (raw) => {
  if (typeof raw !== 'string') return false;
  const text = removePrefix(raw).replace(/[.!?\s]+$/, '');
  return ENTITIES.some(([entity]) =>
    new RegExp(`^(?:add|create|register)\\s+${ARTICLE}${entity}$`, 'i').test(text)
  );
};

/**
 * Recognise explicit current commands only. Field answers and compound tasks
 * remain with the planner, which can interpret them using conversation state.
 */
const detectRequestedTool = (text) => {
  if (typeof text !== 'string' || !text.trim() || text.length > 800) return null;
  const clauses = text.split(/\s*(?:[;\n]|[.!?](?=\s|$)|\b(?:and\s+then|and|then|also|but)\b|,\s*(?=(?:please\s+)?(?:add|create|register|update|edit|change|modify|cancel|remove|delete|deactivate|schedule|book|assign|roster|show|check|view|get|list|find)\b))\s*/i);
  const commands = clauses.map(classifyCommand).filter(Boolean);
  return commands.length === 1 ? commands[0] : null;
};

// Words that mean the message is doing more than answering one question.
// "North Gate, code NG" has two values in it and belongs to the planner; a
// site genuinely called "Centre for Excellence" also lands there, which costs
// a model call and gets the right answer.
const DOING_MORE = /[,;]|\b(?:and|with|called|named|code|for|at|then|also)\b/i;
const MAX_ANSWER_CHARS = 60;

// Someone steering the conversation, not answering the question. Without this,
// "cancel" in reply to "what short code should the site use?" becomes the short
// code, because it is a perfectly good short string.
const CONTROL_WORDS = new Set([
  'cancel', 'stop', 'abort', 'quit', 'exit', 'nevermind', 'never mind',
  'forget it', 'scratch that', 'start over', 'reset', 'undo', 'back', 'skip',
  'no', 'nope', 'nah', 'yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'confirm',
  'help', 'wait',
]);

/**
 * A plain value answering the field question just asked.
 *
 * Returns the trimmed value, or null when the message is doing more than
 * answering — in which case the planner should read it properly rather than
 * having the whole sentence dropped into one field.
 */
const simpleAnswer = (raw) => {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || text.length > MAX_ANSWER_CHARS) return null;
  if (CONTROL_WORDS.has(text.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim())) {
    return null;
  }
  if (DOING_MORE.test(text)) return null;
  if (detectRequestedTool(text)) return null;
  return text;
};

module.exports = {
  detectRequestedTool,
  isBareCommand,
  simpleAnswer,
  sanitiseContext,
  mergeInput,
};
