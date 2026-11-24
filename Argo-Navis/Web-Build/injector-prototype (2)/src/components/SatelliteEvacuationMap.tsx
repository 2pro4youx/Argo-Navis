import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, Maximize2, Minus, Plus } from 'lucide-react';
import {
  DEVICE_ID,
  estimateWalkMinutes,
  findNearestShelter,
  haversineKm,
  type AlertPayload,
  type AlertRegion,
  type GeoPoint,
} from '../core/argoEngine';
import { hapticTap } from '../utils/haptics';
import { SchematicMapCanvas } from './SchematicMapCanvas';

export type MapLayerMode = 'satellite' | 'street' | 'schematic';

export type DeviceStatus = 'IDLE' | 'ALERTED' | 'EVACUATING' | 'CHECKED_IN' | 'ESCALATED';

interface SatelliteEvacuationMapProps {
  userLocation: GeoPoint;
  gpsAccuracyM?: number | null;
  gpsSource?: 'live' | 'manual' | 'preset';
  deviceStatus?: DeviceStatus;
  activeAlert: AlertPayload | null;
  previewRegion?: AlertRegion | null;
  compact?: boolean;
  forceDark?: boolean;
  allowMapClickToSetGps?: boolean;
  onMapClickGps?: (point: GeoPoint) => void;
  testId?: string;
}

const STATUS_COLOR: Record<DeviceStatus, string> = {
  IDLE: '#3b82f6',
  ALERTED: '#f59e0b',
  EVACUATING: '#0284c7',
  CHECKED_IN: '#10b981',
  ESCALATED: '#ef4444',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return ch;
    }
  });
}

export function SatelliteEvacuationMap({
  userLocation,
  gpsAccuracyM = null,
  gpsSource = 'preset',
  deviceStatus = 'IDLE',
  activeAlert,
  previewRegion = null,
  compact = false,
  forceDark = compact,
  allowMapClickToSetGps = false,
  onMapClickGps,
  testId = 'satellite-map-container',
}: SatelliteEvacuationMapProps) {
  const [layerMode, setLayerMode] = useState<MapLayerMode>('satellite');
  const [tileOfflineFallback, setTileOfflineFallback] = useState(false);

  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.LayerGroup | null>(null);
  const overlayLayerRef = useRef<L.LayerGroup | null>(null);
  const lastFitKeyRef = useRef<string>('');
  const lastCenteredLocationRef = useRef<GeoPoint | null>(null);
  const onMapClickRef = useRef(onMapClickGps);
  const allowClickRef = useRef(allowMapClickToSetGps);

  useEffect(() => {
    onMapClickRef.current = onMapClickGps;
    allowClickRef.current = allowMapClickToSetGps;
  }, [onMapClickGps, allowMapClickToSetGps]);

  const nearest = useMemo(() => {
    if (!activeAlert) return null;
    return findNearestShelter(userLocation.lat, userLocation.lon, activeAlert.shelters);
  }, [activeAlert, userLocation]);

  // Initialize Leaflet map once when not in schematic mode
  useEffect(() => {
    if (layerMode === 'schematic') {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        baseLayerRef.current = null;
        overlayLayerRef.current = null;
        lastFitKeyRef.current = '';
      }
      return;
    }

    const host = mapHostRef.current;
    if (!host || mapRef.current) return;

    const map = L.map(host, {
      center: [userLocation.lat, userLocation.lon],
      zoom: 15,
      zoomControl: false,
      attributionControl: !compact,
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false,
    });

    if (!compact && map.attributionControl) {
      map.attributionControl.setPrefix(false);
    }

    const baseGroup = L.layerGroup().addTo(map);
    const overlayGroup = L.layerGroup().addTo(map);

    map.on('click', (ev: L.LeafletMouseEvent) => {
      if (allowClickRef.current && onMapClickRef.current) {
        hapticTap();
        onMapClickRef.current({
          lat: Number(ev.latlng.lat.toFixed(6)),
          lon: Number(ev.latlng.lng.toFixed(6)),
        });
      }
    });

    mapRef.current = map;
    baseLayerRef.current = baseGroup;
    overlayLayerRef.current = overlayGroup;
    lastCenteredLocationRef.current = userLocation;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      overlayLayerRef.current = null;
      lastFitKeyRef.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerMode, compact]);

  // Update tile layers when switching between Satellite, Street, and Light/Nightly Dark
  useEffect(() => {
    const map = mapRef.current;
    const baseGroup = baseLayerRef.current;
    if (!map || !baseGroup || layerMode === 'schematic') return;

    baseGroup.clearLayers();
    let loadedAny = false;
    let errorCount = 0;

    const handleTileLoad = () => {
      loadedAny = true;
      setTileOfflineFallback(false);
    };
    const handleTileError = () => {
      errorCount += 1;
      if (!loadedAny && errorCount >= 6) {
        setTileOfflineFallback(true);
        setLayerMode('schematic');
      }
    };

    if (layerMode === 'satellite') {
      const imagery = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          attribution: '&copy; Esri World Imagery',
        },
      );
      imagery.on('tileload', handleTileLoad);
      imagery.on('tileerror', handleTileError);
      imagery.addTo(baseGroup);

      const labels = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          opacity: 0.85,
        },
      );
      labels.addTo(baseGroup);
    } else {
      // Esri World Street Map requires no API key and loads reliably across light and nightly-dark modes
      const streetLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          attribution: '&copy; Esri World Street Map',
        },
      );
      streetLayer.on('tileload', handleTileLoad);
      streetLayer.on('tileerror', handleTileError);
      streetLayer.addTo(baseGroup);
    }
  }, [layerMode]);

  // Render overlays (geofence circle, shelters, walking routes, GPS fix)
  useEffect(() => {
    const map = mapRef.current;
    const overlayGroup = overlayLayerRef.current;
    if (!map || !overlayGroup || layerMode === 'schematic') return;

    overlayGroup.eachLayer((layer) => {
      if ('closeTooltip' in layer && typeof layer.closeTooltip === 'function') {
        layer.closeTooltip();
      }
    });
    overlayGroup.clearLayers();
    const fitPoints: [number, number][] = [[userLocation.lat, userLocation.lon]];

    const tooltipClassName = forceDark
      ? 'argo-map-tooltip argo-map-tooltip-dark'
      : 'argo-map-tooltip';

    if (activeAlert) {
      L.circle([activeAlert.region.center.lat, activeAlert.region.center.lon], {
        radius: activeAlert.region.radius_km * 1000,
        color: '#ef4444',
        weight: 2,
        dashArray: '6 4',
        fillColor: '#ef4444',
        fillOpacity: 0.08,
      }).addTo(overlayGroup);

      // Fit bounds BEFORE binding permanent tooltips so map.getCenter() reflects final viewport
      const routeAndShelterPts: [number, number][] = [[userLocation.lat, userLocation.lon]];
      activeAlert.shelters.forEach((sh) => {
        routeAndShelterPts.push([sh.lat, sh.lon]);
        sh.route?.forEach((pt) => routeAndShelterPts.push(pt));
      });

      const shelterKey = `${activeAlert.alert_id}:${activeAlert.shelters.map((s) => `${s.lat},${s.lon}`).join(';')}`;
      const prevLoc = lastCenteredLocationRef.current;
      const gpsJumpKm = prevLoc
        ? haversineKm(prevLoc.lat, prevLoc.lon, userLocation.lat, userLocation.lon)
        : 999;

      if (shelterKey !== lastFitKeyRef.current || gpsJumpKm > 1.5) {
        lastFitKeyRef.current = shelterKey;
        lastCenteredLocationRef.current = userLocation;
        if (routeAndShelterPts.length > 1) {
          map.fitBounds(L.latLngBounds(routeAndShelterPts), {
            padding: compact ? [28, 28] : [48, 48],
            maxZoom: 16,
            animate: false,
          });
        } else {
          map.setView([userLocation.lat, userLocation.lon], 14, { animate: false });
        }
      }

      const viewCenterLng = map.getCenter().lng;

      activeAlert.shelters.forEach((sh) => {
        const isNearest = nearest?.shelter.name === sh.name;
        const distKm = haversineKm(userLocation.lat, userLocation.lon, sh.lat, sh.lon);

        if (sh.route && sh.route.length > 1) {
          L.polyline(sh.route, {
            color: isNearest ? '#0ea5e9' : '#64748b',
            weight: isNearest ? 5 : 3,
            opacity: isNearest ? 0.95 : 0.65,
          }).addTo(overlayGroup);
          sh.route.forEach((pt) => fitPoints.push(pt));
        } else if (isNearest) {
          L.polyline(
            [
              [userLocation.lat, userLocation.lon],
              [sh.lat, sh.lon],
            ],
            {
              color: '#22c55e',
              weight: 3.5,
              dashArray: '8 6',
              opacity: 0.9,
            },
          ).addTo(overlayGroup);
        }

        const routeDetail =
          sh.route_km != null && sh.route_min != null
            ? `${sh.route_km.toFixed(2)} km walk (~${sh.route_min} min)`
            : `${distKm.toFixed(2)} km (~${estimateWalkMinutes(distKm)} min walk)`;

        // Orient tooltip inward away from viewport edges and away from user marker
        const shelterDirection: L.Direction =
          sh.lon > viewCenterLng ? 'left' : sh.lon < userLocation.lon ? 'left' : 'right';

        L.circleMarker([sh.lat, sh.lon], {
          radius: isNearest ? (compact ? 7 : 9) : compact ? 5 : 7,
          color: '#ffffff',
          weight: 2,
          fillColor: isNearest ? '#22c55e' : '#15803d',
          fillOpacity: 1,
        })
          .bindTooltip(`${escapeHtml(sh.name)} · ${routeDetail}`, {
            permanent: isNearest && !compact,
            direction: shelterDirection,
            offset: [shelterDirection === 'right' ? 8 : -8, 0],
            className: tooltipClassName,
          })
          .addTo(overlayGroup);

        fitPoints.push([sh.lat, sh.lon]);
      });
    } else {
      if (previewRegion) {
        L.circle([previewRegion.center.lat, previewRegion.center.lon], {
          radius: previewRegion.radius_km * 1000,
          color: '#64748b',
          weight: 1.5,
          dashArray: '5 5',
          fillColor: '#3b82f6',
          fillOpacity: 0.05,
        }).addTo(overlayGroup);
      }

      const standbyKey = 'standby';
      const prevLoc = lastCenteredLocationRef.current;
      const gpsJumpKm = prevLoc
        ? haversineKm(prevLoc.lat, prevLoc.lon, userLocation.lat, userLocation.lon)
        : 999;

      if (standbyKey !== lastFitKeyRef.current) {
        lastFitKeyRef.current = standbyKey;
        lastCenteredLocationRef.current = userLocation;
        map.setView([userLocation.lat, userLocation.lon], 14, { animate: false });
      } else if (gpsJumpKm > 1.5) {
        lastCenteredLocationRef.current = userLocation;
        map.panTo([userLocation.lat, userLocation.lon], { animate: false });
      }
    }

    if (gpsAccuracyM && gpsAccuracyM > 0) {
      L.circle([userLocation.lat, userLocation.lon], {
        radius: gpsAccuracyM,
        color: '#60a5fa',
        weight: 1,
        fillColor: '#3b82f6',
        fillOpacity: 0.14,
      }).addTo(overlayGroup);
    }

    const gpsMarkerColor = STATUS_COLOR[deviceStatus];
    const gpsTooltip = `${DEVICE_ID} · ${deviceStatus}${
      deviceStatus === 'ESCALATED' ? ' (RESCUE NEEDED)' : ''
    }`;
    const gpsDirection: L.Direction =
      nearest && nearest.shelter.lat >= userLocation.lat ? 'bottom' : 'top';
    L.circleMarker([userLocation.lat, userLocation.lon], {
      radius: compact ? 8 : 10,
      color: '#ffffff',
      weight: 2.5,
      fillColor: gpsMarkerColor,
      fillOpacity: 1,
    })
      .bindTooltip(escapeHtml(gpsTooltip), {
        permanent: !compact,
        direction: gpsDirection,
        offset: [0, gpsDirection === 'bottom' ? 8 : -8],
        className: tooltipClassName,
      })
      .addTo(overlayGroup);
  }, [
    layerMode,
    forceDark,
    userLocation,
    gpsAccuracyM,
    deviceStatus,
    activeAlert,
    previewRegion,
    nearest,
    compact,
  ]);

  const handleCenterGps = () => {
    hapticTap();
    mapRef.current?.setView([userLocation.lat, userLocation.lon], 15, { animate: false });
  };

  const handleFitZone = () => {
    hapticTap();
    const map = mapRef.current;
    if (!map) return;
    if (activeAlert) {
      const pts: [number, number][] = [[userLocation.lat, userLocation.lon]];
      activeAlert.shelters.forEach((s) => pts.push([s.lat, s.lon]));
      if (pts.length > 1) {
        map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 16, animate: false });
      } else {
        map.setView([activeAlert.region.center.lat, activeAlert.region.center.lon], 12, {
          animate: false,
        });
      }
    } else if (previewRegion) {
      map.setView([previewRegion.center.lat, previewRegion.center.lon], 12, { animate: false });
    }
  };

  const nearestDistKm = nearest?.shelter.route_km ?? nearest?.distanceKm ?? null;
  const nearestWalkMin =
    nearest?.shelter.route_min ??
    (nearestDistKm != null ? estimateWalkMinutes(nearestDistKm) : null);

  const floatingChromeClass = forceDark
    ? 'border-[#1E2636] bg-[#080B10]/92 text-[#D4DCE6] shadow-md'
    : 'border-slate-200/95 bg-white/94 text-slate-800 shadow-sm dark:border-[#1E2636] dark:bg-[#080B10]/92 dark:text-[#D4DCE6] dark:shadow-md';

  const mapSurfaceClass = forceDark
    ? 'bg-[#07090D] argo-map-force-dark'
    : 'bg-slate-100 dark:bg-[#07090D]';

  const mapFilterClass =
    layerMode === 'street'
      ? 'argo-map-dark-street'
      : layerMode === 'satellite'
        ? 'argo-map-dark-satellite'
        : '';

  return (
    <div
      data-testid={testId}
      data-map-mode={layerMode}
      className={`relative isolate z-0 h-full w-full overflow-hidden ${mapSurfaceClass} ${mapFilterClass} ${
        allowMapClickToSetGps && layerMode !== 'schematic' ? 'cursor-crosshair' : ''
      }`}
    >
      {layerMode === 'schematic' ? (
        <SchematicMapCanvas
          userLocation={userLocation}
          shelters={activeAlert?.shelters ?? []}
          region={activeAlert?.region ?? previewRegion}
          gpsAccuracyM={gpsAccuracyM}
          compact={compact}
          forceDark={forceDark}
        />
      ) : (
        <div ref={mapHostRef} className="h-full w-full" />
      )}

      {/* Top Map Toolbar: Layer Switcher + Zoom/GPS/Zone Quick Controls */}
      <div className="pointer-events-none absolute top-2 inset-x-2 z-[500] flex flex-wrap items-center justify-between gap-1.5 sm:top-2.5 sm:inset-x-2.5">
        <div
          className={`pointer-events-auto flex items-center gap-0.5 rounded-lg border p-0.5 backdrop-blur-xs ${floatingChromeClass}`}
        >
          {(
            [
              { id: 'satellite', short: 'SAT', full: 'Satellite' },
              { id: 'street', short: 'MAP', full: 'Street' },
              { id: 'schematic', short: 'GRID', full: 'Metric Grid' },
            ] as const
          ).map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => {
                hapticTap();
                if (mode.id !== 'schematic') setTileOfflineFallback(false);
                setLayerMode(mode.id);
              }}
              aria-pressed={layerMode === mode.id}
              className={`rounded-md px-1.5 sm:px-2 py-1 text-[10px] font-semibold transition-colors whitespace-nowrap ${
                layerMode === mode.id
                  ? forceDark
                    ? 'bg-[#182030] text-[#E2E8F0]'
                    : 'bg-slate-900 text-white dark:bg-[#182030] dark:text-[#E2E8F0]'
                  : forceDark
                    ? 'text-slate-400 hover:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {compact ? (
                mode.short
              ) : (
                <>
                  <span className="sm:hidden">{mode.short}</span>
                  <span className="hidden sm:inline">{mode.full}</span>
                </>
              )}
            </button>
          ))}
        </div>

        {/* Top-right Zoom, GPS & Zone Quick Controls (Control Room mode) */}
        {!compact && layerMode !== 'schematic' && (
          <div className="pointer-events-auto flex items-center gap-1 sm:gap-1.5">
            <div
              className={`flex items-center overflow-hidden rounded-lg border backdrop-blur-xs ${floatingChromeClass}`}
            >
              <button
                type="button"
                onClick={() => {
                  hapticTap();
                  mapRef.current?.zoomIn();
                }}
                aria-label="Zoom in"
                className={`px-2 py-1 transition-colors ${
                  forceDark ? 'hover:bg-[#141A26]' : 'hover:bg-slate-100 dark:hover:bg-[#141A26]'
                }`}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  hapticTap();
                  mapRef.current?.zoomOut();
                }}
                aria-label="Zoom out"
                className={`border-l px-2 py-1 transition-colors ${
                  forceDark
                    ? 'border-[#1E2636] hover:bg-[#141A26]'
                    : 'border-slate-200 hover:bg-slate-100 dark:border-[#1E2636] dark:hover:bg-[#141A26]'
                }`}
              >
                <Minus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <button
              type="button"
              onClick={handleCenterGps}
              aria-label="Center map on GPS"
              title="Center GPS"
              className={`inline-flex items-center gap-1 rounded-lg border px-2 sm:px-2.5 py-1 text-[11px] font-medium backdrop-blur-xs transition-colors whitespace-nowrap ${floatingChromeClass} ${
                forceDark ? 'hover:border-slate-600' : 'hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <Crosshair className="h-3.5 w-3.5 sm:h-3 sm:w-3 text-blue-600 dark:text-sky-400" aria-hidden="true" />
              <span className="hidden sm:inline">Center GPS</span>
            </button>
            {(activeAlert || previewRegion) && (
              <button
                type="button"
                onClick={handleFitZone}
                aria-label="Fit alert zone"
                title="Fit Zone"
                className={`inline-flex items-center gap-1 rounded-lg border px-2 sm:px-2.5 py-1 text-[11px] font-medium backdrop-blur-xs transition-colors whitespace-nowrap ${floatingChromeClass} ${
                  forceDark ? 'hover:border-slate-600' : 'hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <Maximize2
                  className="h-3.5 w-3.5 sm:h-3 sm:w-3 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Fit Zone</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bottom GPS & Nearest Shelter Readout */}
      {layerMode !== 'schematic' && (
        <div
          className={`pointer-events-none absolute bottom-2.5 left-2.5 z-[500] flex flex-col items-start gap-1 ${
            compact ? 'right-2.5' : 'right-44'
          }`}
        >
          {nearest && nearestDistKm != null && (
            <div className="max-w-full truncate rounded-md border border-emerald-700/60 bg-emerald-950/92 px-2 py-1 font-mono text-[10px] font-semibold text-emerald-200 shadow-sm backdrop-blur-xs tabular-nums">
              {nearest.shelter.name} · {nearestDistKm.toFixed(2)} km (~{nearestWalkMin}m walk)
            </div>
          )}

          {(!compact || !nearest) && (
            <div
              className={`max-w-full truncate rounded-md border px-2 py-1 font-mono text-[10px] backdrop-blur-xs tabular-nums ${floatingChromeClass}`}
            >
              <span>
                {userLocation.lat.toFixed(4)}, {userLocation.lon.toFixed(4)}
              </span>
              <span className="mx-1.5 opacity-50">·</span>
              <span
                className={
                  gpsSource === 'live'
                    ? forceDark
                      ? 'text-emerald-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                    : forceDark
                      ? 'text-slate-400'
                      : 'text-slate-600 dark:text-slate-400'
                }
              >
                {gpsSource === 'live'
                  ? `LIVE GPS${gpsAccuracyM ? ` (±${Math.round(gpsAccuracyM)}m)` : ''}`
                  : gpsSource === 'manual'
                    ? 'MANUAL GPS'
                    : 'PRESET GPS'}
              </span>
              {allowMapClickToSetGps && !compact && (
                <>
                  <span className="mx-1.5 opacity-50">·</span>
                  <span className={forceDark ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'}>
                    Click map to move GPS
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {tileOfflineFallback && layerMode === 'schematic' && (
        <div className="pointer-events-none absolute right-2.5 bottom-7 z-[500] rounded-md border border-amber-700/60 bg-amber-950/90 px-2 py-1 text-[10px] font-medium text-amber-200">
          Map tiles unreachable — offline metric grid active
        </div>
      )}
    </div>
  );
}
