import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  SHARED_SECRET,
  SCENARIO_PRESETS,
  hmacSha256Hex,
  constantTimeEqualHex,
  verifyHmacSha256,
  haversineKm,
  findNearestShelter,
  processPollResponse,
  isValidGpsFix,
  generateDemoShelters,
  pickSheltersFromOverpassElements,
  thinRoutePoints,
  estimateWalkMinutes,
  projectToMetricKm,
  computeMetricViewport,
  type ServiceState,
} from './argoEngine';
import { createZipBytes } from './zipBuilder';

test('hmacSha256Hex matches Node crypto reference implementation', () => {
  const sample = '{"alert_id":"argo-1","type":"EARTHQUAKE"}';
  const expected = crypto.createHmac('sha256', SHARED_SECRET).update(sample, 'utf8').digest('hex');
  assert.equal(hmacSha256Hex(sample, SHARED_SECRET), expected);

  const clearMsg = 'argo-1|CLEARED';
  const expectedClear = crypto
    .createHmac('sha256', SHARED_SECRET)
    .update(clearMsg, 'utf8')
    .digest('hex');
  assert.equal(hmacSha256Hex(clearMsg, SHARED_SECRET), expectedClear);
});

test('constantTimeEqualHex validates case-insensitively and rejects tampering', () => {
  const mac = hmacSha256Hex('payload-123');
  assert.equal(constantTimeEqualHex(mac, mac.toUpperCase()), true);
  assert.equal(constantTimeEqualHex(mac, `${mac.slice(0, -1)}0` === mac ? `${mac.slice(0, -1)}1` : `${mac.slice(0, -1)}0`), false);
  assert.equal(constantTimeEqualHex(mac, mac.slice(0, 10)), false);
  assert.equal(verifyHmacSha256('payload-123', mac), true);
  assert.equal(verifyHmacSha256('payload-124', mac), false);
});

test('haversineKm and findNearestShelter compute accurate distances', () => {
  assert.equal(haversineKm(35.6812, 139.7671, 35.6812, 139.7671), 0);
  // Tokyo Station to Shibuya Station (~6.1 km)
  const dist = haversineKm(35.6812, 139.7671, 35.6580, 139.7016);
  assert.ok(dist > 5.5 && dist < 7.0, `Expected ~6.4km, got ${dist}`);

  const eq = SCENARIO_PRESETS[0];
  const nearest = findNearestShelter(
    eq.defaultUserLocation.lat,
    eq.defaultUserLocation.lon,
    eq.payload.shelters,
  );
  assert.ok(nearest);
  assert.equal(nearest.shelter.name, 'Marunouchi Plaza');
  assert.ok(nearest.distanceKm < 1.0);
});

test('processPollResponse executes full 6-step happy path, reserve power, and ALL_CLEAR', () => {
  const eq = SCENARIO_PRESETS[0];
  const rawPayload = JSON.stringify(eq.payload);
  const sig = hmacSha256Hex(rawPayload);

  const initial: ServiceState = {
    seenPayloads: [],
    activeAlert: null,
    reservePowerActive: false,
  };

  // Normal battery (72%) inside region
  const res1 = processPollResponse(
    initial,
    { status: 'ACTIVE', payload: rawPayload, sig },
    eq.defaultUserLocation,
    72,
  );
  assert.equal(res1.action, 'LAUNCH_ALERT');
  assert.deepEqual(
    res1.emittedEvents.map((e) => e.event),
    ['ALERT_RECEIVED', 'SIGNATURE_OK', 'IN_REGION', 'SIREN_ON'],
  );
  assert.equal(res1.nextState.reservePowerActive, false);

  // Duplicate payload is ignored
  const dup = processPollResponse(
    res1.nextState,
    { status: 'ACTIVE', payload: rawPayload, sig },
    eq.defaultUserLocation,
    72,
  );
  assert.equal(dup.action, 'NONE');
  assert.equal(dup.emittedEvents.length, 0);

  // Invalid clear_sig is ignored
  const badClear = processPollResponse(
    res1.nextState,
    { status: 'CLEARED', alert_id: eq.payload.alert_id, clear_sig: 'deadbeef' },
    eq.defaultUserLocation,
    72,
  );
  assert.equal(badClear.action, 'NONE');
  assert.equal(badClear.emittedEvents.length, 0);

  // Valid clear_sig clears alert and emits ALL_CLEAR
  const clearSig = hmacSha256Hex(`${eq.payload.alert_id}|CLEARED`);
  const cleared = processPollResponse(
    res1.nextState,
    { status: 'CLEARED', alert_id: eq.payload.alert_id, clear_sig: clearSig },
    eq.defaultUserLocation,
    72,
  );
  assert.equal(cleared.action, 'CLEAR_ALERT');
  assert.deepEqual(
    cleared.emittedEvents.map((e) => e.event),
    ['ALL_CLEAR'],
  );
  assert.equal(cleared.nextState.activeAlert, null);

  // Battery <= 5 triggers RESERVE_POWER_ACTIVE
  const lowBat = processPollResponse(
    initial,
    { status: 'ACTIVE', payload: rawPayload, sig },
    eq.defaultUserLocation,
    4,
  );
  assert.equal(lowBat.action, 'LAUNCH_ALERT');
  assert.equal(lowBat.nextState.reservePowerActive, true);
  assert.deepEqual(
    lowBat.emittedEvents.map((e) => e.event),
    ['ALERT_RECEIVED', 'SIGNATURE_OK', 'IN_REGION', 'RESERVE_POWER_ACTIVE', 'SIREN_ON'],
  );
});

test('processPollResponse stops on SIGNATURE_FAIL, OUT_OF_REGION, and invalid GPS fix', () => {
  const eq = SCENARIO_PRESETS[0];
  const rawPayload = JSON.stringify(eq.payload);
  const initial: ServiceState = {
    seenPayloads: [],
    activeAlert: null,
    reservePowerActive: false,
  };

  const badSig = processPollResponse(
    initial,
    { status: 'ACTIVE', payload: rawPayload, sig: '0'.repeat(64) },
    eq.defaultUserLocation,
    80,
  );
  assert.equal(badSig.action, 'NONE');
  assert.deepEqual(
    badSig.emittedEvents.map((e) => e.event),
    ['ALERT_RECEIVED', 'SIGNATURE_FAIL'],
  );

  const validSig = hmacSha256Hex(rawPayload);
  const outRegion = processPollResponse(
    initial,
    { status: 'ACTIVE', payload: rawPayload, sig: validSig },
    eq.outsideUserLocation,
    80,
  );
  assert.equal(outRegion.action, 'NONE');
  assert.deepEqual(
    outRegion.emittedEvents.map((e) => e.event),
    ['ALERT_RECEIVED', 'SIGNATURE_OK', 'OUT_OF_REGION'],
  );

  const nullIsland = processPollResponse(
    initial,
    { status: 'ACTIVE', payload: rawPayload, sig: validSig },
    { lat: 0, lon: 0 },
    80,
  );
  assert.equal(nullIsland.action, 'NONE');
  assert.equal(nullIsland.emittedEvents[2].detail, 'gps_fix=unavailable');
});

test('isValidGpsFix validates coordinate bounds and rejects Null Island', () => {
  assert.equal(isValidGpsFix({ lat: 23.2599, lon: 77.4126 }), true);
  assert.equal(isValidGpsFix({ lat: 0, lon: 0 }), false);
  assert.equal(isValidGpsFix({ lat: 95, lon: 10 }), false);
  assert.equal(isValidGpsFix({ lat: 10, lon: -190 }), false);
  assert.equal(isValidGpsFix({ lat: Number.NaN, lon: 77 }), false);
  assert.equal(isValidGpsFix(null), false);
});

test('pickSheltersFromOverpassElements filters, sorts, and limits per amenity kind', () => {
  const elements = [
    { lat: 23.265, lon: 77.415, tags: { amenity: 'school', name: 'Model School A' } },
    { lat: 23.261, lon: 77.414, tags: { amenity: 'school', name: 'Model School A' } }, // duplicate name
    { lat: 23.262, lon: 77.414, tags: { amenity: 'school', name: 'Central School B' } },
    { lat: 23.270, lon: 77.420, tags: { amenity: 'school', name: 'Third School C' } }, // exceeds maxPerKind=2
    { center: { lat: 23.260, lon: 77.4127 }, tags: { amenity: 'hospital', name: 'Hamidia Hospital' } },
    { lat: 23.263, lon: 77.411, tags: { amenity: 'unknown_tag', name: 'Ignored Place' } },
  ];

  const picked = pickSheltersFromOverpassElements(elements, 23.2599, 77.4126, 5, 2);
  assert.equal(picked.length, 3);
  assert.equal(picked[0].kind, 'Hospital');
  assert.ok(picked[0].name.includes('Hamidia Hospital (Hospital)'));
  assert.equal(picked.filter((s) => s.kind === 'School').length, 2);
});

test('generateDemoShelters, thinRoutePoints, and estimateWalkMinutes match argo_sim.py', () => {
  const demo = generateDemoShelters(23.2599, 77.4126);
  assert.equal(demo.length, 3);
  assert.ok(demo[0].distance_km && demo[0].distance_km > 0.5);

  const pts: [number, number][] = Array.from({ length: 140 }, (_, i) => [23 + i * 0.001, 77]);
  const thinned = thinRoutePoints(pts, 70);
  assert.equal(thinned.length, 70);
  assert.deepEqual(thinned[0], pts[0]);
  assert.deepEqual(thinned[thinned.length - 1], pts[pts.length - 1]);

  assert.equal(estimateWalkMinutes(2.5), 30);
});

test('computeMetricViewport preserves isotropic 1:1 km-per-pixel scale across latitudes', () => {
  // At 47.37N (Zurich), 1 km North and 1 km East must map to identical pixel lengths
  const refLat = 47.3769;
  const refLon = 8.5417;
  const north1Km = {
    lat: refLat + 1 / 110.57,
    lon: refLon,
  };
  const east1Km = {
    lat: refLat,
    lon: refLon + 1 / (111.32 * Math.cos((refLat * Math.PI) / 180)),
  };

  const vp = computeMetricViewport(
    [{ lat: refLat, lon: refLon }, north1Km, east1Km],
    640,
    360,
  );
  const p0 = vp.project(refLat, refLon);
  const pN = vp.project(north1Km.lat, north1Km.lon);
  const pE = vp.project(east1Km.lat, east1Km.lon);

  const dNorthPx = Math.hypot(pN.x - p0.x, pN.y - p0.y);
  const dEastPx = Math.hypot(pE.x - p0.x, pE.y - p0.y);
  assert.ok(Math.abs(dNorthPx - dEastPx) < 0.05, `Expected equal px/km: ${dNorthPx} vs ${dEastPx}`);

  const metric = projectToMetricKm(east1Km.lat, east1Km.lon, refLat, refLon);
  assert.ok(Math.abs(metric.xKm - 1.0) < 0.001);
  assert.ok(Math.abs(metric.yKm) < 0.001);
});

test('createZipBytes outputs valid PKZip local header and EOCD', () => {
  const bytes = createZipBytes([
    { path: 'ArgoAlert/settings.gradle.kts', content: 'rootProject.name = "ArgoAlert"\n' },
    { path: 'ArgoAlert/app/AndroidManifest.xml', content: '<manifest/>' },
  ]);
  // Local file header magic PK\x03\x04
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(bytes[2], 0x03);
  assert.equal(bytes[3], 0x04);
  // EOCD magic PK\x05\x06 at tail - 22
  const eocdPos = bytes.length - 22;
  assert.equal(bytes[eocdPos], 0x50);
  assert.equal(bytes[eocdPos + 1], 0x4b);
  assert.equal(bytes[eocdPos + 2], 0x05);
  assert.equal(bytes[eocdPos + 3], 0x06);
});
