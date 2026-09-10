/**
 * Location Constants
 *
 * States/territories, timezones, and location-related constants.
 * Currently supports Australia + India.
 */

// Australian States and Territories
export const AUSTRALIAN_STATES = [
  { code: 'NSW', name: 'New South Wales' },
  { code: 'VIC', name: 'Victoria' },
  { code: 'QLD', name: 'Queensland' },
  { code: 'WA', name: 'Western Australia' },
  { code: 'SA', name: 'South Australia' },
  { code: 'TAS', name: 'Tasmania' },
  { code: 'ACT', name: 'Australian Capital Territory' },
  { code: 'NT', name: 'Northern Territory' }
];

// Indian States and Union Territories (ISO 3166-2:IN codes)
export const INDIAN_STATES = [
  { code: 'AN', name: 'Andaman and Nicobar Islands' },
  { code: 'AP', name: 'Andhra Pradesh' },
  { code: 'AR', name: 'Arunachal Pradesh' },
  { code: 'AS', name: 'Assam' },
  { code: 'BR', name: 'Bihar' },
  { code: 'CH', name: 'Chandigarh' },
  { code: 'CT', name: 'Chhattisgarh' },
  { code: 'DN', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: 'DL', name: 'Delhi' },
  { code: 'GA', name: 'Goa' },
  { code: 'GJ', name: 'Gujarat' },
  { code: 'HR', name: 'Haryana' },
  { code: 'HP', name: 'Himachal Pradesh' },
  { code: 'JK', name: 'Jammu and Kashmir' },
  { code: 'JH', name: 'Jharkhand' },
  { code: 'KA', name: 'Karnataka' },
  { code: 'KL', name: 'Kerala' },
  { code: 'LA', name: 'Ladakh' },
  { code: 'LD', name: 'Lakshadweep' },
  { code: 'MP', name: 'Madhya Pradesh' },
  { code: 'MH', name: 'Maharashtra' },
  { code: 'MN', name: 'Manipur' },
  { code: 'ML', name: 'Meghalaya' },
  { code: 'MZ', name: 'Mizoram' },
  { code: 'NL', name: 'Nagaland' },
  { code: 'OR', name: 'Odisha' },
  { code: 'PY', name: 'Puducherry' },
  { code: 'PB', name: 'Punjab' },
  { code: 'RJ', name: 'Rajasthan' },
  { code: 'SK', name: 'Sikkim' },
  { code: 'TN', name: 'Tamil Nadu' },
  { code: 'TG', name: 'Telangana' },
  { code: 'TR', name: 'Tripura' },
  { code: 'UP', name: 'Uttar Pradesh' },
  { code: 'UT', name: 'Uttarakhand' },
  { code: 'WB', name: 'West Bengal' }
];

// Grouped list shown in <StateInput>. Only Australia is exposed as a preset
// group for now — Indian users pick "Other (enter manually)" and type the
// state name. `INDIAN_STATES` is still exported for the state→IST timezone
// logic; add it here later if we want a preset picker for India.
export const STATE_GROUPS = [
  { label: 'Australia', options: AUSTRALIAN_STATES }
];

// Australian Timezones
export const AUSTRALIAN_TIMEZONES = [
  { value: 'Australia/Perth', label: '(UTC+08:00) Perth', state: 'WA' },
  { value: 'Australia/Eucla', label: '(UTC+08:45) Eucla', state: 'WA' },
  { value: 'Australia/Darwin', label: '(UTC+09:30) Darwin', state: 'NT' },
  { value: 'Australia/Brisbane', label: '(UTC+10:00) Brisbane', state: 'QLD' },
  { value: 'Australia/Adelaide', label: '(UTC+10:30) Adelaide', state: 'SA' },
  { value: 'Australia/Sydney', label: '(UTC+10:00) Sydney', state: 'NSW' },
  { value: 'Australia/Melbourne', label: '(UTC+10:00) Melbourne', state: 'VIC' },
  { value: 'Australia/Hobart', label: '(UTC+10:00) Hobart', state: 'TAS' },
  { value: 'Australia/Canberra', label: '(UTC+10:00) Canberra', state: 'ACT' },
  { value: 'Australia/Lord_Howe', label: '(UTC+10:30) Lord Howe Island', state: 'NSW' },
];

// Indian Timezone (single zone for the whole country)
export const INDIAN_TIMEZONES = [
  { value: 'Asia/Kolkata', label: '(UTC+05:30) India Standard Time' }
];

// AU + IN, exposed to Site/Company timezone pickers.
export const SUPPORTED_TIMEZONES = [
  ...AUSTRALIAN_TIMEZONES,
  ...INDIAN_TIMEZONES
];

// The subset the Company model accepts (see server/src/models/Company.js).
// Keep these in step — offering a timezone the model rejects fails validation.
export const ORGANISATION_TIMEZONE_VALUES = [
  'Australia/Perth',
  'Australia/Darwin',
  'Australia/Brisbane',
  'Australia/Adelaide',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Hobart',
  'Asia/Kolkata'
];

export const ORGANISATION_TIMEZONES = SUPPORTED_TIMEZONES.filter((tz) =>
  ORGANISATION_TIMEZONE_VALUES.includes(tz.value)
);

// Country code default for geocoding autocomplete. Empty string means
// no country filter (worldwide search) — the app now supports AU + IN.
export const DEFAULT_COUNTRY_CODE = '';

// Default coordinates (Sydney, NSW)
export const DEFAULT_COORDINATES = {
  latitude: -33.8688,
  longitude: 151.2093
};
