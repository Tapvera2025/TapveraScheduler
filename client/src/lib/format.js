/**
 * Date and time formatting, driven by the organisation's own settings
 *
 * Screens should use these instead of calling toLocaleDateString directly, so
 * changing the format in Settings actually changes what people see.
 */

// Explicit extension so this module can also be loaded directly by node
import { getCompanySettings } from "../store/companyStore.js";

export const DATE_FORMATS = [
  { value: "DD/MM/YYYY", label: "31/12/2026 (day first)" },
  { value: "MM/DD/YYYY", label: "12/31/2026 (month first)" },
  { value: "YYYY-MM-DD", label: "2026-12-31 (ISO)" },
  { value: "DD MMM YYYY", label: "31 Dec 2026" },
];

export const TIME_FORMATS = [
  { value: "24h", label: "24 hour (17:30)" },
  { value: "12h", label: "12 hour (5:30 PM)" },
];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const pad = (value) => String(value).padStart(2, "0");

const asDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * A date in the organisation's chosen format.
 */
export const formatDate = (value, fallback = "—") => {
  const date = asDate(value);
  if (!date) return fallback;

  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();

  switch (getCompanySettings().dateFormat) {
    case "MM/DD/YYYY":
      return `${month}/${day}/${year}`;
    case "YYYY-MM-DD":
      return `${year}-${month}-${day}`;
    case "DD MMM YYYY":
      return `${day} ${MONTHS[date.getMonth()]} ${year}`;
    case "DD/MM/YYYY":
    default:
      return `${day}/${month}/${year}`;
  }
};

/**
 * A time in the organisation's chosen 12 or 24 hour format.
 */
export const formatTime = (value, fallback = "—") => {
  const date = asDate(value);
  if (!date) return fallback;

  const hours = date.getHours();
  const minutes = pad(date.getMinutes());

  if (getCompanySettings().timeFormat === "12h") {
    const suffix = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 === 0 ? 12 : hours % 12;
    return `${hour12}:${minutes} ${suffix}`;
  }

  return `${pad(hours)}:${minutes}`;
};

/**
 * Date and time together.
 */
export const formatDateTime = (value, fallback = "—") => {
  const date = asDate(value);
  if (!date) return fallback;
  return `${formatDate(date)} ${formatTime(date)}`;
};

/**
 * A short day-and-month label, for chart axes and compact rows.
 */
export const formatDayMonth = (value, fallback = "—") => {
  const date = asDate(value);
  if (!date) return fallback;
  return `${pad(date.getDate())} ${MONTHS[date.getMonth()]}`;
};
