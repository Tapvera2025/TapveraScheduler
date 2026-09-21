const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { route, routeRead, routeEntityFree, isEntityFree } = require('./intentRouter');
const { needsChoice, CODES } = require('./errors');
const { normalizeText } = require('./normalizer');

const TZ = 'Asia/Kolkata';
const EMP = '(employeeId: aaaaaaaaaaaaaaaaaaaaaaaa)';
const SITE = '(siteId: bbbbbbbbbbbbbbbbbbbbbbbb)';
const EMP_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SITE_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const today = () => DateTime.now().setZone(TZ);
const iso = (dt) => dt.toFormat('yyyy-MM-dd');

test('an utterance that names a site is not treated as entity-free', () => {
  // Skipping entity resolution here would drop the site filter in silence and
  // answer for the whole organisation.
  for (const text of [
    'list employees at Tapvera HQ',
    'who is working today at Tapvera HQ',
    'show all staff at the north gate',
    "show Archi's shifts",
  ]) {
    assert.equal(isEntityFree(text), false, text);
    assert.equal(routeEntityFree(text), null, text);
  }
});

test('an utterance that names nobody still skips entity resolution', () => {
  assert.deepEqual(routeEntityFree('list all employees'), { tool: 'listEmployees', input: {} });
  assert.deepEqual(routeEntityFree('who is working today'), { tool: 'getDailySummary', input: {} });
  assert.deepEqual(routeEntityFree('show me the daily summary'), { tool: 'getDailySummary', input: {} });
});

test('a site filter survives the fast path', () => {
  assert.deepEqual(
    routeRead(`list employees at Tapvera HQ ${SITE}`),
    { tool: 'listEmployees', input: { siteId: SITE_ID } }
  );
  assert.deepEqual(
    routeRead(`who is working ${iso(today())} at Tapvera HQ ${SITE}`),
    { tool: 'getDailySummary', input: { date: iso(today()), siteId: SITE_ID } }
  );
});

test('a question about who is working beats the employee list', () => {
  const date = iso(today());
  for (const text of [
    `show all staff working ${date}`,
    `which employees are on shift ${date}`,
    `list the team rostered ${date}`,
  ]) {
    assert.deepEqual(routeRead(text), { tool: 'getDailySummary', input: { date } }, text);
  }
  // A plain list is still a plain list.
  assert.deepEqual(routeRead('list all employees'), { tool: 'listEmployees', input: {} });
});

test('one date means one day, not the start of a fortnight', () => {
  const date = iso(today().plus({ days: 1 }));
  assert.deepEqual(
    route(`shifts for Archisman Dutta ${EMP} on ${date}`),
    { tool: 'findEmployeeShifts', input: { employeeId: EMP_ID, from: date, to: date } }
  );
  // A range is passed through as a range.
  const from = iso(today());
  const to = iso(today().plus({ days: 6 }));
  assert.deepEqual(
    route(`shifts for Archisman Dutta ${EMP} ${from} to ${to}`),
    { tool: 'findEmployeeShifts', input: { employeeId: EMP_ID, from, to } }
  );
  // No date at all leaves the tool to apply its own default window.
  assert.deepEqual(
    route(`show shifts for Archisman Dutta ${EMP}`),
    { tool: 'findEmployeeShifts', input: { employeeId: EMP_ID } }
  );
});

test('a bare day name means today when today is that day', () => {
  const now = today();
  const dayName = now.toFormat('cccc');
  assert.match(normalizeText(`shifts on ${dayName}`, TZ), new RegExp(iso(now)));
  // "next" still means the following week.
  assert.match(
    normalizeText(`shifts next ${dayName}`, TZ),
    new RegExp(iso(now.plus({ weeks: 1 })))
  );
  // A different day is the next upcoming one, never in the past.
  const other = now.plus({ days: 3 });
  assert.match(normalizeText(`shifts on ${other.toFormat('cccc')}`, TZ), new RegExp(iso(other)));
});

test('three-letter day abbreviations are not read as dates on their own', () => {
  // These are ordinary English words and must survive untouched.
  for (const text of ['sat with the team', 'the sun was out', 'mon is not a day here']) {
    assert.equal(normalizeText(text, TZ), text, text);
  }
  // With a modifier in front they are unambiguous.
  assert.match(normalizeText('next sat', TZ), /\d{4}-\d{2}-\d{2}/);
});

test('"this <period>" and "tonight" keep their date', () => {
  const date = iso(today());
  assert.match(normalizeText('who is working this afternoon', TZ), new RegExp(`${date} 12:00`));
  assert.match(normalizeText('who is working this morning', TZ), new RegExp(`${date} 06:00`));
  assert.match(normalizeText('who is working tonight', TZ), new RegExp(`${date} 21:00`));
  // No stray modifier is left behind.
  assert.doesNotMatch(normalizeText('who is working this afternoon', TZ), /working this \d/);
});

test('a question about the sites themselves lists the sites', () => {
  for (const text of [
    'what sites are available?',
    'which sites do we have',
    'list all sites',
    'show me our sites',
    'how many sites are there',
    'site list',
  ]) {
    assert.deepEqual(routeRead(text), { tool: 'listSites', input: {} }, text);
  }
});

test('a site merely mentioned in a question does not list the sites', () => {
  // The site has to be the subject. These are questions about shifts, staff
  // and the roster that happen to name where.
  assert.equal(routeRead('show shifts at site 2'), null);
  assert.equal(routeRead('list employees at site 2').tool, 'listEmployees');
  assert.equal(routeRead('show me the roster for site A').tool, 'getDailySummary');
});

test('a question that carries its own answers stays a question', () => {
  // The client shows INVALID_INPUT as a conversational prompt and anything
  // else as a failure. A field the tool still needs is the former, so the
  // code must not change just because options are attached.
  const err = needsChoice('Which site should the shift be at?', {
    entity: 'site',
    candidates: [{ id: 'a', name: 'Tapvera HQ' }, { id: 'b', name: 'North Gate' }],
  });

  assert.equal(err.code, CODES.INVALID_INPUT);
  assert.equal(err.details.entity, 'site');
  assert.equal(err.details.choose, true);
  assert.equal(err.details.candidates.length, 2);
  // The planner still needs to know which field is outstanding.
  assert.deepEqual(err.details.missing, ['siteName']);
  // And it has to survive the trip to the browser.
  assert.equal(JSON.parse(JSON.stringify(err.toJSON())).details.candidates[1].name, 'North Gate');
});

test('week and month ranges are unaffected', () => {
  assert.match(normalizeText('this week', TZ), /\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2} \(this week\)/);
  assert.match(normalizeText('next month', TZ), /\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2} \(next month\)/);
});
