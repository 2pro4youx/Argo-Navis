import {
  SHELTER_TAGS,
  WALK_KMH,
  generateDemoShelters,
  haversineKm,
  pickSheltersFromOverpassElements,
  thinRoutePoints,
  type GeoPoint,
  type OverpassElement,
  type Shelter,
} from '../core/argoEngine';

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const ROUTING_URL =
  'https://routing.openstreetmap.de/routed-foot/route/v1/foot/{lo1},{la1};{lo2},{la2}?overview=full&geometries=geojson';

interface CachedRoute {
  route: [number, number][];
  route_km: number;
  route_min: number;
}

const shelterCache = new Map<string, Shelter[]>();
const routeCache = new Map<string, CachedRoute>();

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchOverpassElements(
  lat: number,
  lon: number,
  radiusM: number,
): Promise<OverpassElement[]> {
  const amenities = Object.keys(SHELTER_TAGS).join('|');
  const query = `[out:json][timeout:12];(nwr["amenity"~"^(${amenities})$"]["name"](around:${radiusM},${lat},${lon}););out center 80;`;

  let lastErr: unknown = null;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: new URLSearchParams({ data: query }).toString(),
        },
        4500,
      );
      if (!res.ok) {
        lastErr = new Error(`Overpass HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { elements?: OverpassElement[] };
      return data.elements ?? [];
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Overpass unreachable');
}

export interface ShelterLookupResult {
  shelters: Shelter[];
  source: string;
}

export async function findSheltersForLocation(
  lat: number,
  lon: number,
  count = 5,
): Promise<ShelterLookupResult> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = shelterCache.get(key);
  if (cached) {
    return {
      shelters: cached.map((s) => ({
        ...s,
        distance_km: Number(haversineKm(lat, lon, s.lat, s.lon).toFixed(2)),
      })),
      source: 'OpenStreetMap (cached)',
    };
  }

  try {
    let found: Shelter[] = [];
    for (const radiusM of [2500, 6000, 15000]) {
      const elements = await fetchOverpassElements(lat, lon, radiusM);
      found = pickSheltersFromOverpassElements(elements, lat, lon, count);
      if (found.length >= 3) break;
    }
    if (found.length === 0) {
      throw new Error('No named shelter buildings found nearby');
    }
    shelterCache.set(key, found);
    return { shelters: found, source: 'OpenStreetMap' };
  } catch {
    return {
      shelters: generateDemoShelters(lat, lon),
      source: 'DEMO shelters (offline fallback)',
    };
  }
}

async function fetchOsrmFootRoute(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): Promise<CachedRoute> {
  const url = ROUTING_URL.replace('{lo1}', String(fromLon))
    .replace('{la1}', String(fromLat))
    .replace('{lo2}', String(toLon))
    .replace('{la2}', String(toLat));

  const res = await fetchWithTimeout(url, { method: 'GET' }, 4500);
  if (!res.ok) {
    throw new Error(`OSRM HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    routes?: Array<{
      distance: number;
      geometry: { coordinates: [number, number][] };
    }>;
  };
  const rt = data.routes?.[0];
  if (!rt || !rt.geometry?.coordinates?.length) {
    throw new Error('No walking route returned');
  }
  const pts: [number, number][] = rt.geometry.coordinates.map(([lo, la]) => [
    Number(la.toFixed(5)),
    Number(lo.toFixed(5)),
  ]);
  const km = rt.distance / 1000;
  return {
    route: thinRoutePoints(pts, 70),
    route_km: Number(km.toFixed(2)),
    route_min: Math.round((km / WALK_KMH) * 60),
  };
}

/**
 * Attaches pedestrian walking routes (OSRM OpenStreetMap foot profile) from origin
 * to the nearest `maxRoutes` shelters, ordered by straight-line Haversine distance.
 * Gracefully falls back to straight-line distances if OSRM is unreachable.
 */
export async function attachWalkingRoutes(
  origin: GeoPoint,
  shelters: Shelter[],
  maxRoutes = 3,
): Promise<Shelter[]> {
  const sorted = [...shelters]
    .map((s) => ({
      ...s,
      distance_km: Number(haversineKm(origin.lat, origin.lon, s.lat, s.lon).toFixed(2)),
    }))
    .sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));

  return Promise.all(
    sorted.map(async (shelter, i) => {
      const sh = { ...shelter };
      if (i < maxRoutes) {
        const key = `${origin.lat.toFixed(4)},${origin.lon.toFixed(4)}>${sh.lat.toFixed(5)},${sh.lon.toFixed(5)}`;
        let info = routeCache.get(key);
        if (!info) {
          try {
            info = await fetchOsrmFootRoute(origin.lat, origin.lon, sh.lat, sh.lon);
            routeCache.set(key, info);
          } catch {
            // Gracefully fall back to straight-line Haversine distance
          }
        }
        if (info) {
          sh.route = info.route;
          sh.route_km = info.route_km;
          sh.route_min = info.route_min;
        }
      }
      return sh;
    }),
  );
}
