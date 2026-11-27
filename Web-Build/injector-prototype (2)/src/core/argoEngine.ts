export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface AlertRegion {
  center: GeoPoint;
  radius_km: number;
}

export interface Shelter {
  name: string;
  lat: number;
  lon: number;
  kind?: string;
  distance_km?: number;
  route?: [number, number][];
  route_km?: number;
  route_min?: number;
}

export interface AlertPayload {
  alert_id: string;
  type: string;
  severity: string;
  headline: string;
  region: AlertRegion;
  shelters: Shelter[];
  shelter_source?: string;
  protocol_steps: string[];
  protocol_note: string;
  checkin_interval_s: number;
}

export interface PollResponse {
  status: 'NONE' | 'ACTIVE' | 'CLEARED';
  payload?: string;
  sig?: string;
  alert_id?: string;
  clear_sig?: string;
}

export interface DeviceEvent {
  id: string;
  timestamp: string;
  device: string;
  event:
    | 'ALERT_RECEIVED'
    | 'SIGNATURE_OK'
    | 'SIGNATURE_FAIL'
    | 'IN_REGION'
    | 'OUT_OF_REGION'
    | 'RESERVE_POWER_ACTIVE'
    | 'SIREN_ON'
    | 'SLIDER_CONFIRMED'
    | 'NEAREST_SHELTER'
    | 'CHECKIN'
    | 'ESCALATED'
    | 'ALL_CLEAR';
  detail: string;
  lat: number;
  lon: number;
}

export const SHARED_SECRET = 'argo-demo-shared-secret';
export const DEVICE_ID = 'emu1';
const EARTH_RADIUS_KM = 6371.0;

// --- Pure synchronous SHA-256 & HMAC-SHA256 (FIPS 180-4 / RFC 2104) ---

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Bytes(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const paddedLen = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;

  const view = new DataView(padded.buffer);
  const highBits = Math.floor(bitLen / 0x100000000);
  const lowBits = bitLen >>> 0;
  view.setUint32(paddedLen - 8, highBits, false);
  view.setUint32(paddedLen - 4, lowBits, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

const utf8Encoder = new TextEncoder();

export function hmacSha256Hex(message: string, secret: string = SHARED_SECRET): string {
  const blockSize = 64;
  let keyBytes: Uint8Array = utf8Encoder.encode(secret);
  if (keyBytes.length > blockSize) {
    keyBytes = sha256Bytes(keyBytes);
  }
  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(keyBytes);

  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = paddedKey[i] ^ 0x5c;
    iKeyPad[i] = paddedKey[i] ^ 0x36;
  }

  const msgBytes = utf8Encoder.encode(message);
  const innerInput = new Uint8Array(blockSize + msgBytes.length);
  innerInput.set(iKeyPad);
  innerInput.set(msgBytes, blockSize);
  const innerHash = sha256Bytes(innerInput);

  const outerInput = new Uint8Array(blockSize + innerHash.length);
  outerInput.set(oKeyPad);
  outerInput.set(innerHash, blockSize);
  const macBytes = sha256Bytes(outerInput);

  let hex = '';
  for (let i = 0; i < macBytes.length; i++) {
    hex += macBytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();
  if (normA.length === 0 || normA.length !== normB.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < normA.length; i++) {
    diff |= normA.charCodeAt(i) ^ normB.charCodeAt(i);
  }
  return diff === 0;
}

export function verifyHmacSha256(
  message: string,
  providedHex: string | undefined,
  secret: string = SHARED_SECRET,
): boolean {
  if (!providedHex) return false;
  const expected = hmacSha256Hex(message, secret);
  return constantTimeEqualHex(expected, providedHex);
}

// --- Haversine & Nearest Shelter ---

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const clamped = Math.min(1, Math.max(0, a));
  const c = 2 * Math.asin(Math.sqrt(clamped));
  return EARTH_RADIUS_KM * c;
}

export function findNearestShelter(
  userLat: number,
  userLon: number,
  shelters: Shelter[],
): { shelter: Shelter; distanceKm: number } | null {
  if (shelters.length === 0) return null;
  let best = shelters[0];
  let bestDist = haversineKm(userLat, userLon, best.lat, best.lon);
  for (let i = 1; i < shelters.length; i++) {
    const dist = haversineKm(userLat, userLon, shelters[i].lat, shelters[i].lon);
    if (dist < bestDist) {
      best = shelters[i];
      bestDist = dist;
    }
  }
  return { shelter: best, distanceKm: bestDist };
}

// --- AlertService 6-step pipeline state machine ---

export interface ServiceState {
  seenPayloads: string[];
  activeAlert: AlertPayload | null;
  reservePowerActive: boolean;
}

export interface PollTransitionResult {
  nextState: ServiceState;
  emittedEvents: Omit<DeviceEvent, 'id' | 'timestamp'>[];
  action: 'NONE' | 'LAUNCH_ALERT' | 'CLEAR_ALERT';
}

export function processPollResponse(
  state: ServiceState,
  response: PollResponse,
  location: GeoPoint,
  batteryPct: number,
): PollTransitionResult {
  const emitted: Omit<DeviceEvent, 'id' | 'timestamp'>[] = [];
  const push = (event: DeviceEvent['event'], detail: string) => {
    emitted.push({
      device: DEVICE_ID,
      event,
      detail,
      lat: Number(location.lat.toFixed(6)),
      lon: Number(location.lon.toFixed(6)),
    });
  };

  if (response.status === 'CLEARED') {
    const targetId = response.alert_id ?? state.activeAlert?.alert_id;
    if (!targetId) {
      return { nextState: state, emittedEvents: [], action: 'NONE' };
    }
    const validClear = verifyHmacSha256(`${targetId}|CLEARED`, response.clear_sig);
    if (!validClear) {
      return { nextState: state, emittedEvents: [], action: 'NONE' };
    }
    push('ALL_CLEAR', `alert_id=${targetId}`);
    return {
      nextState: {
        seenPayloads: [],
        activeAlert: null,
        reservePowerActive: false,
      },
      emittedEvents: emitted,
      action: 'CLEAR_ALERT',
    };
  }

  if (response.status !== 'ACTIVE' || !response.payload) {
    return { nextState: state, emittedEvents: [], action: 'NONE' };
  }

  const rawPayload = response.payload;
  if (state.seenPayloads.includes(rawPayload)) {
    return { nextState: state, emittedEvents: [], action: 'NONE' };
  }

  const seenPayloads = [...state.seenPayloads, rawPayload];

  // Step 1: ALERT_RECEIVED
  push('ALERT_RECEIVED', `bytes=${rawPayload.length}`);

  // Step 2: Verify HMAC-SHA256
  if (!verifyHmacSha256(rawPayload, response.sig)) {
    push('SIGNATURE_FAIL', 'HMAC-SHA256 verification failed');
    return {
      nextState: { ...state, seenPayloads },
      emittedEvents: emitted,
      action: 'NONE',
    };
  }
  push('SIGNATURE_OK', 'HMAC-SHA256 verified');

  let parsed: AlertPayload;
  try {
    parsed = JSON.parse(rawPayload) as AlertPayload;
  } catch {
    return {
      nextState: { ...state, seenPayloads },
      emittedEvents: emitted,
      action: 'NONE',
    };
  }

  // Step 3: Haversine distance check (requires valid GPS fix)
  if (!isValidGpsFix(location)) {
    push('OUT_OF_REGION', 'gps_fix=unavailable');
    return {
      nextState: { ...state, seenPayloads },
      emittedEvents: emitted,
      action: 'NONE',
    };
  }
  const distKm = haversineKm(
    location.lat,
    location.lon,
    parsed.region.center.lat,
    parsed.region.center.lon,
  );
  if (!Number.isFinite(distKm) || distKm > parsed.region.radius_km) {
    push(
      'OUT_OF_REGION',
      `distance_km=${Number.isFinite(distKm) ? distKm.toFixed(2) : 'NaN'} radius_km=${parsed.region.radius_km.toFixed(2)}`,
    );
    return {
      nextState: { ...state, seenPayloads },
      emittedEvents: emitted,
      action: 'NONE',
    };
  }
  push(
    'IN_REGION',
    `distance_km=${distKm.toFixed(2)} radius_km=${parsed.region.radius_km.toFixed(2)}`,
  );

  // Step 4: Reserve power check
  const reservePowerActive = batteryPct <= 5;
  if (reservePowerActive) {
    push('RESERVE_POWER_ACTIVE', `battery=${batteryPct}%`);
  }

  // Step 5: Launch AlertActivity & SIREN_ON
  push('SIREN_ON', `alert_id=${parsed.alert_id} type=${parsed.type}`);

  return {
    nextState: {
      seenPayloads,
      activeAlert: parsed,
      reservePowerActive,
    },
    emittedEvents: emitted,
    action: 'LAUNCH_ALERT',
  };
}

// --- Deterministic Emergency Scenarios ---

export interface ScenarioPreset {
  id: string;
  label: string;
  payload: AlertPayload;
  defaultUserLocation: GeoPoint;
  outsideUserLocation: GeoPoint;
}

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: 'earthquake',
    label: 'Earthquake (M7.4)',
    defaultUserLocation: { lat: 35.6812, lon: 139.7671 },
    outsideUserLocation: { lat: 36.1200, lon: 140.4200 },
    payload: {
      alert_id: 'argo-eq-2026-01',
      type: 'EARTHQUAKE',
      severity: 'EXTREME · M7.4',
      headline: 'Major seismic event detected. Evacuate unstable structures immediately.',
      region: {
        center: { lat: 35.685, lon: 139.77 },
        radius_km: 15,
      },
      shelters: [
        { name: 'Chiyoda Civic Hall', lat: 35.6915, lon: 139.7565 },
        { name: 'Hibiya Park Safe Zone', lat: 35.6742, lon: 139.7568 },
        { name: 'Sumida River Refuge', lat: 35.6892, lon: 139.7895 },
        { name: 'Marunouchi Plaza', lat: 35.6838, lon: 139.7642 },
      ],
      protocol_steps: [
        'Drop, cover head, and hold on until violent shaking stops.',
        'Exit building via stairwells only; never use elevators.',
        'Move directly to the highlighted green shelter zone on foot.',
        'Watch for falling glass, downed power lines, and aftershocks.',
        'Tap CHECK-IN before countdown expires to confirm safety.',
      ],
      protocol_note:
        'Civil Protection Directive CP-14 · Official OEM override active until signed ALL_CLEAR broadcast.',
      checkin_interval_s: 30,
    },
  },
  {
    id: 'tsunami',
    label: 'Tsunami Warning',
    defaultUserLocation: { lat: 37.7749, lon: -122.4924 },
    outsideUserLocation: { lat: 38.2500, lon: -121.8500 },
    payload: {
      alert_id: 'argo-ts-2026-02',
      type: 'TSUNAMI',
      severity: 'CRITICAL · 8M WAVE',
      headline: 'Destructive coastal surge incoming within 14 minutes. Move to high ground.',
      region: {
        center: { lat: 37.772, lon: -122.498 },
        radius_km: 12,
      },
      shelters: [
        { name: 'Sutro Heights Ridge', lat: 37.7795, lon: -122.5112 },
        { name: 'Twin Peaks Overlook', lat: 37.7544, lon: -122.4477 },
        { name: 'Golden Gate Heights', lat: 37.7568, lon: -122.4785 },
        { name: 'Lincoln Park High Ground', lat: 37.7852, lon: -122.5015 },
      ],
      protocol_steps: [
        'Leave coastal low-lying roads immediately on foot.',
        'Climb at least 30 meters above sea level to the nearest marked refuge.',
        'Do not return to the shoreline after the first wave recedes.',
        'Confirm your location via the circular CHECK-IN control.',
      ],
      protocol_note:
        'Pacific Coastal Civil Alert · Multi-wave hazard remains active until official ALL_CLEAR.',
      checkin_interval_s: 30,
    },
  },
  {
    id: 'flood',
    label: 'Flash Flood',
    defaultUserLocation: { lat: 47.3769, lon: 8.5417 },
    outsideUserLocation: { lat: 47.9200, lon: 9.1800 },
    payload: {
      alert_id: 'argo-fl-2026-03',
      type: 'FLASH FLOOD',
      severity: 'SEVERE · DAM BREACH',
      headline: 'Rapid river rise in valley corridor. Evacuate basements and riverbanks now.',
      region: {
        center: { lat: 47.378, lon: 8.545 },
        radius_km: 10,
      },
      shelters: [
        { name: 'ETH Terrace Assembly', lat: 47.3764, lon: 8.5484 },
        { name: 'Lindenhof Hill Shelter', lat: 47.3728, lon: 8.5408 },
        { name: 'Fluntern Upper School', lat: 47.3812, lon: 8.5592 },
      ],
      protocol_steps: [
        'Move immediately away from river channels and underground transit.',
        'Never walk or drive across moving floodwater.',
        'Proceed uphill to the highlighted assembly point.',
        'Use CHECK-IN periodically so rescue dispatch tracks your status.',
      ],
      protocol_note:
        'Federal Hydrological Emergency Protocol HY-09 · Keep device screen active for updates.',
      checkin_interval_s: 30,
    },
  },
];

// --- Python argo_sim.py Parity: Cities, Protocols, Shelters, Routes & Metric Projection ---

export const WALK_KMH = 5.0;

export const SHELTER_TAGS: Record<string, string> = {
  community_centre: 'Community Hall',
  townhall: 'Town Hall',
  school: 'School',
  college: 'College',
  university: 'University',
  place_of_worship: 'Place of Worship',
  hospital: 'Hospital',
};

export const SHELTER_OFFSETS: ReadonlyArray<readonly [number, number, string]> = [
  [0.012, 0.009, 'Govt. Higher Secondary School Relief Camp (demo)'],
  [-0.015, 0.006, 'Community Hall Shelter (demo)'],
  [0.004, -0.018, 'District Stadium Shelter (demo)'],
];

export interface CityPreset {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export const PYTHON_CITIES: CityPreset[] = [
  { id: 'bhopal', name: 'Bhopal', lat: 23.2599, lon: 77.4126 },
  { id: 'chennai', name: 'Chennai', lat: 13.0827, lon: 80.2707 },
  { id: 'visakhapatnam', name: 'Visakhapatnam', lat: 17.6868, lon: 83.2185 },
  { id: 'guwahati', name: 'Guwahati', lat: 26.1445, lon: 91.7362 },
];

export const PROTOCOL_NOTE_SAMPLE =
  'SAMPLE TEXT for the demo. Replace with the official NDMA / state SDMA guidelines.';

export const DISASTER_PROTOCOLS: Record<string, string[]> = {
  CYCLONE: [
    'Move to the nearest cyclone shelter now; do not wait for landfall.',
    'Carry ID, medicines, drinking water, a torch and a charged power bank.',
    'Switch off gas and electricity before you leave.',
    'Stay inside the shelter until the official all-clear.',
  ],
  FLOOD: [
    'Move to higher ground or the nearest relief camp immediately.',
    'Do not walk or drive through flowing water.',
    'Switch off electricity at the mains if it is safe to do so.',
    'Stay at the shelter until the all-clear.',
  ],
  'FLASH FLOOD': [
    'Move immediately away from river channels and underground transit.',
    'Never walk or drive across moving floodwater.',
    'Proceed uphill to the highlighted assembly point.',
    'Use CHECK-IN periodically so rescue dispatch tracks your status.',
  ],
  TSUNAMI: [
    'Move immediately to high ground or as far inland as you can.',
    'Do not go to the shore to look; waves can arrive in several surges.',
    'Go on foot if roads are jammed.',
    'Stay away from the coast until officials say it is safe.',
  ],
  EARTHQUAKE: [
    'Drop, cover and hold on until the shaking stops.',
    'Then move to open ground, away from buildings and power lines.',
    'Expect aftershocks; do not re-enter damaged buildings.',
    'Go to the nearest shelter if your home is unsafe.',
  ],
  WILDFIRE: [
    'Leave now along the designated route, away from the fire.',
    'Close windows and doors behind you; wear a mask or wet cloth.',
    'Do not return until authorities allow it.',
    'Go to the nearest shelter and register your arrival.',
  ],
};

export function isValidGpsFix(point: GeoPoint | null | undefined): point is GeoPoint {
  if (!point) return false;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return false;
  if (point.lat < -90 || point.lat > 90 || point.lon < -180 || point.lon > 180) return false;
  if (point.lat === 0 && point.lon === 0) return false;
  return true;
}

export function estimateWalkMinutes(km: number): number {
  if (!Number.isFinite(km) || km < 0) return 0;
  return Math.round((km / WALK_KMH) * 60);
}

export function generateDemoShelters(lat: number, lon: number): Shelter[] {
  return SHELTER_OFFSETS.map(([dy, dx, name]) => {
    const sLat = Number((lat + dy).toFixed(5));
    const sLon = Number((lon + dx).toFixed(5));
    return {
      name,
      lat: sLat,
      lon: sLon,
      kind: 'Demo shelter',
      distance_km: Number(haversineKm(lat, lon, sLat, sLon).toFixed(2)),
    };
  });
}

export interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string | undefined>;
}

export function pickSheltersFromOverpassElements(
  elements: OverpassElement[],
  lat: number,
  lon: number,
  maxCount = 5,
  maxPerKind = 2,
): Shelter[] {
  interface Candidate {
    dist: number;
    name: string;
    kind: string;
    lat: number;
    lon: number;
  }

  const cands: Candidate[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const amenity = tags.amenity;
    const kind = amenity ? SHELTER_TAGS[amenity] : undefined;
    const rawName = tags.name?.trim();
    const coord = el.center ?? el;
    const la = coord.lat;
    const lo = coord.lon;
    if (
      kind &&
      rawName &&
      typeof la === 'number' &&
      typeof lo === 'number' &&
      Number.isFinite(la) &&
      Number.isFinite(lo)
    ) {
      cands.push({
        dist: haversineKm(lat, lon, la, lo),
        name: rawName,
        kind,
        lat: la,
        lon: lo,
      });
    }
  }

  cands.sort((a, b) => a.dist - b.dist);

  const out: Shelter[] = [];
  const counts: Record<string, number> = {};
  const seen = new Set<string>();

  for (const c of cands) {
    const lower = c.name.toLowerCase();
    if (seen.has(lower) || (counts[c.kind] ?? 0) >= maxPerKind) {
      continue;
    }
    seen.add(lower);
    counts[c.kind] = (counts[c.kind] ?? 0) + 1;
    out.push({
      name: `${c.name.slice(0, 34)} (${c.kind})`,
      lat: Number(c.lat.toFixed(5)),
      lon: Number(c.lon.toFixed(5)),
      kind: c.kind,
      distance_km: Number(c.dist.toFixed(2)),
    });
    if (out.length >= maxCount) break;
  }

  return out;
}

export function thinRoutePoints(
  pts: [number, number][],
  maxPts = 70,
): [number, number][] {
  if (pts.length <= maxPts || maxPts < 2) return pts;
  const step = (pts.length - 1) / (maxPts - 1);
  const out: [number, number][] = [];
  for (let i = 0; i < maxPts; i++) {
    out.push(pts[Math.round(i * step)]);
  }
  return out;
}

// --- Isotropic Metric Projection (matches argo_sim.py cos(lat) scaling) ---

export interface MetricViewport {
  centerLat: number;
  centerLon: number;
  pxPerKm: number;
  project: (lat: number, lon: number) => { x: number; y: number };
}

export function projectToMetricKm(
  lat: number,
  lon: number,
  refLat: number,
  refLon: number,
): { xKm: number; yKm: number } {
  const cosLat = Math.max(0.01, Math.cos((refLat * Math.PI) / 180));
  return {
    xKm: (lon - refLon) * 111.32 * cosLat,
    yKm: (lat - refLat) * 110.57,
  };
}

export function computeMetricViewport(
  points: GeoPoint[],
  width: number,
  height: number,
  padFracX = 0.16,
  padFracY = 0.17,
  minSpanKm = 1.2,
): MetricViewport {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  if (points.length === 0) {
    return {
      centerLat: 0,
      centerLon: 0,
      pxPerKm: 20,
      project: () => ({ x: safeW / 2, y: safeH / 2 }),
    };
  }

  let minLat = points[0].lat;
  let maxLat = points[0].lat;
  let minLon = points[0].lon;
  let maxLon = points[0].lon;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;

  const topRight = projectToMetricKm(maxLat, maxLon, centerLat, centerLon);
  const bottomLeft = projectToMetricKm(minLat, minLon, centerLat, centerLon);

  const spanXKm = Math.max(topRight.xKm - bottomLeft.xKm, minSpanKm);
  const spanYKm = Math.max(topRight.yKm - bottomLeft.yKm, minSpanKm);

  const usableW = Math.max(1, safeW * (1 - 2 * padFracX));
  const usableH = Math.max(1, safeH * (1 - 2 * padFracY));
  const pxPerKm = Math.min(usableW / spanXKm, usableH / spanYKm);

  const cx = safeW / 2;
  const cy = safeH / 2;

  return {
    centerLat,
    centerLon,
    pxPerKm,
    project: (lat: number, lon: number) => {
      const { xKm, yKm } = projectToMetricKm(lat, lon, centerLat, centerLon);
      return {
        x: cx + xKm * pxPerKm,
        y: cy - yKm * pxPerKm,
      };
    },
  };
}

