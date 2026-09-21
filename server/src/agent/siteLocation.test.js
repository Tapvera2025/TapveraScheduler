const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_RADIUS_M,
  readLocation,
  fromSiteDoc,
  geofenceSummary,
  pickerLocation,
} = require('./siteLocation');
const { PICKER_ONLY_KEYS } = require('./registry');
const { CODES } = require('./errors');

const refuses = (fn, pattern) =>
  assert.throws(fn, (err) => {
    assert.equal(err.code, CODES.INVALID_INPUT);
    if (pattern) assert.match(err.message, pattern);
    return true;
  });

test('no location given means no geofence, not an error', () => {
  assert.equal(readLocation({}), null);
  assert.equal(readLocation({ latitude: '', longitude: '  ' }), null);
});

test('a picked point becomes a geofence with the form\'s default radius', () => {
  const location = readLocation({ latitude: '12.9715987', longitude: '77.5945627' });
  assert.deepEqual(location, {
    latitude: 12.971599,
    longitude: 77.594563,
    geoFenceRadius: DEFAULT_RADIUS_M,
  });
  // Southern hemisphere, which is most of this product's sites.
  assert.equal(readLocation({ latitude: '-33.8688', longitude: '151.2093' }).latitude, -33.8688);
});

test('the radius follows the site form\'s limits', () => {
  const at = (r) => readLocation({ latitude: '12.97', longitude: '77.59', geoFenceRadius: r });
  assert.equal(at('100').geoFenceRadius, 100);
  assert.equal(at('5000').geoFenceRadius, 5000);
  assert.equal(at('499.6').geoFenceRadius, 500);
  refuses(() => at('50'), /between 100 m and 5 km/);
  refuses(() => at('5001'), /between 100 m and 5 km/);
  refuses(() => at('wide'), /number of metres/);
});

test('half a location, an impossible one, or a failed GPS fix is refused', () => {
  refuses(() => readLocation({ latitude: '12.97' }), /both a latitude and a longitude/);
  refuses(() => readLocation({ longitude: '77.59' }), /both a latitude and a longitude/);
  refuses(() => readLocation({ latitude: '91', longitude: '77.59' }), /Latitude/);
  refuses(() => readLocation({ latitude: '12.97', longitude: '-181' }), /Longitude/);
  refuses(() => readLocation({ latitude: 'north', longitude: '77.59' }), /Latitude/);
  // 0,0 is in the Atlantic, and it is what a failed fix reports.
  refuses(() => readLocation({ latitude: '0', longitude: '0' }), /not a real site/);
});

test('a radius on its own changes an existing geofence and nothing else', () => {
  const existing = { latitude: -33.8688, longitude: 151.2093, geoFenceRadius: 300 };
  assert.deepEqual(readLocation({ geoFenceRadius: '800' }, { existing }), { ...existing, geoFenceRadius: 800 });

  // With no point to draw it around, a radius means nothing.
  refuses(() => readLocation({ geoFenceRadius: '800' }), /needs a location first/);

  // A new point keeps the radius the site already had.
  assert.equal(readLocation({ latitude: '-33.87', longitude: '151.21' }, { existing }).geoFenceRadius, 300);
});

test('a stored site reads back in the same shape', () => {
  assert.deepEqual(
    fromSiteDoc({ location: { type: 'Point', coordinates: [151.2093, -33.8688] }, geoFenceRadius: 450 }),
    { latitude: -33.8688, longitude: 151.2093, geoFenceRadius: 450 }
  );
  assert.equal(fromSiteDoc({}), null);
  assert.equal(fromSiteDoc(null), null);
  assert.equal(fromSiteDoc({ location: { coordinates: [] } }), null);
});

test('the preview always says whether there is a geofence', () => {
  // The unset case is the one that matters: clock-in is allowed from anywhere.
  assert.match(geofenceSummary(null), /can clock in from anywhere/);

  const location = { latitude: 12.971599, longitude: 77.594563, geoFenceRadius: 300 };
  assert.equal(geofenceSummary(location, 'MG Road, Bengaluru'), '300 m around MG Road, Bengaluru');
  assert.equal(geofenceSummary({ ...location, geoFenceRadius: 1500 }), '1.5 km around 12.97160, 77.59456');
  assert.equal(geofenceSummary({ ...location, geoFenceRadius: 2000 }, 'X'), '2 km around X');
});

test('the picker opens where the admin left off', () => {
  const opened = pickerLocation(
    { latitude: 12.97, longitude: 77.59, geoFenceRadius: 500 },
    { address: 'MG Road', townSuburb: 'Bengaluru', state: 'KA', postalCode: '560001' }
  );
  assert.deepEqual(opened, {
    latitude: 12.97, longitude: 77.59, geoFenceRadius: 500,
    address: 'MG Road', townSuburb: 'Bengaluru', state: 'KA', postalCode: '560001',
  });
  // Nothing set yet still opens, at the default radius.
  assert.equal(pickerLocation(null).latitude, null);
  assert.equal(pickerLocation(null).geoFenceRadius, DEFAULT_RADIUS_M);
});

test('the model may never supply coordinates', () => {
  // Stripped from planner proposals; the gateway still accepts them from the
  // map picker, which is where the admin has actually seen the pin.
  assert.deepEqual(PICKER_ONLY_KEYS.slice().sort(), ['latitude', 'longitude']);

  const { TOOLS } = require('./registry');
  for (const tool of TOOLS) {
    for (const key of PICKER_ONLY_KEYS) {
      const field = tool.parameters?.properties?.[key];
      if (!field) continue;
      assert.match(field.description, /map picker/i, `${tool.name}.${key} must say it is picker-only`);
    }
  }
});

test('coordinates proposed by the model are dropped before they reach a tool', () => {
  const { stripReserved } = require('./planner');
  const proposed = {
    siteLocationName: 'North Gate',
    latitude: '28.6315',
    longitude: '77.2167',
    geoFenceRadius: '400',
    companyId: 'another-tenant',
  };
  assert.deepEqual(stripReserved(proposed), {
    siteLocationName: 'North Gate',
    // A stated radius is language, and fine to take from the model.
    geoFenceRadius: '400',
  });
});
