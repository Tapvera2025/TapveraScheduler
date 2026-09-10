/**
 * Civil time for the agent.
 *
 * Every window the agent reports on is a half-open interval [start, endExclusive)
 * of UTC instants, derived from a civil date in an explicit IANA timezone. This
 * is the only place that turns "this month" into instants, so a daylight-saving
 * transition or a month boundary is handled once rather than per screen.
 */

const { DateTime } = require('luxon');
const { invalidInput } = require('./errors');

const DEFAULT_TIMEZONE = 'Australia/Sydney';

/**
 * The timezone a report should be expressed in.
 * Site timezone wins over company timezone, because a shift happens where the
 * site is. Falls back to a documented default rather than the server's locale.
 */
const reportingTimezone = ({ siteTimezone, companyTimezone } = {}) =>
  siteTimezone || companyTimezone || DEFAULT_TIMEZONE;

const assertValidZone = (timezone) => {
  if (!DateTime.local().setZone(timezone).isValid) {
    throw invalidInput(`Unknown timezone: ${timezone}`);
  }
};

/**
 * Resolve a month reference to a half-open UTC window.
 *
 * @param {Object} params
 * @param {String} [params.month]   - 'YYYY-MM'. Defaults to the current month in `timezone`.
 * @param {String} params.timezone  - IANA zone the civil month is expressed in.
 * @param {Date}   [params.now]     - Injected for tests.
 * @returns {{ periodStart: Date, periodEndExclusive: Date, timezone: String, label: String, asOf: Date }}
 */
const resolveMonthWindow = ({ month, timezone, now = new Date() } = {}) => {
  assertValidZone(timezone);

  const reference = DateTime.fromJSDate(now).setZone(timezone);
  let start;

  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw invalidInput(`month must look like YYYY-MM, received "${month}"`);
    }
    start = DateTime.fromFormat(month, 'yyyy-MM', { zone: timezone }).startOf('month');
    if (!start.isValid) throw invalidInput(`Could not read month "${month}"`);
  } else {
    start = reference.startOf('month');
  }

  const endExclusive = start.plus({ months: 1 });

  return {
    periodStart: start.toUTC().toJSDate(),
    periodEndExclusive: endExclusive.toUTC().toJSDate(),
    timezone,
    label: start.toFormat('LLLL yyyy'),
    asOf: now,
  };
};

/**
 * Resolve an explicit civil date range to a half-open UTC window.
 * `to` is inclusive as a civil date, so it is advanced by one day internally.
 */
const resolveDateRangeWindow = ({ from, to, timezone, now = new Date() } = {}) => {
  assertValidZone(timezone);

  const parse = (value, name) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
      throw invalidInput(`${name} must look like YYYY-MM-DD, received "${value}"`);
    }
    const parsed = DateTime.fromFormat(value, 'yyyy-MM-dd', { zone: timezone }).startOf('day');
    if (!parsed.isValid) throw invalidInput(`Could not read ${name} "${value}"`);
    return parsed;
  };

  const start = parse(from, 'from');
  const endExclusive = parse(to, 'to').plus({ days: 1 });

  if (endExclusive <= start) {
    throw invalidInput('"to" must not be earlier than "from"');
  }

  return {
    periodStart: start.toUTC().toJSDate(),
    periodEndExclusive: endExclusive.toUTC().toJSDate(),
    timezone,
    label: `${start.toFormat('d LLL yyyy')} to ${endExclusive.minus({ days: 1 }).toFormat('d LLL yyyy')}`,
    asOf: now,
  };
};

/** A civil-time string for display and speech, in the reporting zone. */
const inZone = (value, timezone, format = 'd LLL yyyy, HH:mm') => {
  if (!value) return null;
  const dt = DateTime.fromJSDate(new Date(value)).setZone(timezone);
  return dt.isValid ? dt.toFormat(format) : null;
};

const hoursBetween = (start, end) => {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms > 0 ? Math.round((ms / 3600000) * 100) / 100 : 0;
};

module.exports = {
  DEFAULT_TIMEZONE,
  reportingTimezone,
  resolveMonthWindow,
  resolveDateRangeWindow,
  inZone,
  hoursBetween,
};
