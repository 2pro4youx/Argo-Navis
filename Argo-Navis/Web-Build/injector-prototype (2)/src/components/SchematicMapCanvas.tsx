import { useEffect, useRef } from 'react';
import {
  computeMetricViewport,
  estimateWalkMinutes,
  findNearestShelter,
  type AlertRegion,
  type GeoPoint,
  type Shelter,
} from '../core/argoEngine';
import { useThemeMode } from '../utils/themeStore';

interface SchematicMapCanvasProps {
  userLocation: GeoPoint;
  shelters: Shelter[];
  region?: AlertRegion | null;
  gpsAccuracyM?: number | null;
  compact?: boolean;
  forceDark?: boolean;
}

function chooseScaleBarKm(pxPerKm: number, maxBarPx: number): { km: number; label: string } {
  const candidatesKm = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50];
  let best = candidatesKm[0];
  for (const c of candidatesKm) {
    if (c * pxPerKm <= maxBarPx) {
      best = c;
    }
  }
  const label = best < 1 ? `${Math.round(best * 1000)} m` : `${best} km`;
  return { km: best, label };
}

export function SchematicMapCanvas({
  userLocation,
  shelters,
  region = null,
  gpsAccuracyM = null,
  compact = false,
  forceDark = false,
}: SchematicMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const storeTheme = useThemeMode();
  const effectiveTheme = forceDark ? 'dark' : storeTheme;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isLight = effectiveTheme === 'light';

    const render = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.round(w * dpr);
      const targetH = Math.round(h * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Canvas background & schematic grid
      ctx.fillStyle = isLight ? '#F1F5F9' : '#07090D';
      ctx.fillRect(0, 0, w, h);

      const spacing = compact ? 32 : 40;
      ctx.strokeStyle = isLight ? '#DCE4EE' : '#131A26';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = spacing; x < w; x += spacing) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
      }
      for (let y = spacing; y < h; y += spacing) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
      }
      ctx.stroke();

      // Include user + shelters + route waypoints (and region center when no shelters)
      const viewportPoints: GeoPoint[] = [userLocation];
      for (const s of shelters) {
        viewportPoints.push({ lat: s.lat, lon: s.lon });
        if (s.route) {
          for (const [rLat, rLon] of s.route) {
            viewportPoints.push({ lat: rLat, lon: rLon });
          }
        }
      }
      if (region && shelters.length === 0) {
        viewportPoints.push(region.center);
      }

      const viewport = computeMetricViewport(
        viewportPoints,
        w,
        h,
        compact ? 0.16 : 0.14,
        compact ? 0.18 : 0.16,
        shelters.length === 0 ? 4.0 : 1.0,
      );

      const userPos = viewport.project(userLocation.lat, userLocation.lon);
      const nearest = findNearestShelter(userLocation.lat, userLocation.lon, shelters);

      // Alert geofence circle (true metric radius in pixels)
      if (region) {
        const regCenter = viewport.project(region.center.lat, region.center.lon);
        const radiusPx = region.radius_km * viewport.pxPerKm;
        if (radiusPx > 4 && radiusPx < Math.max(w, h) * 8) {
          ctx.save();
          ctx.fillStyle = isLight ? 'rgba(220, 38, 38, 0.07)' : 'rgba(255, 59, 59, 0.08)';
          ctx.strokeStyle = isLight ? 'rgba(220, 38, 38, 0.72)' : 'rgba(248, 113, 113, 0.75)';
          ctx.lineWidth = 1.75;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.arc(regCenter.x, regCenter.y, radiusPx, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }

      // Draw OSRM walking routes for secondary shelters first, then primary nearest route
      for (const shelter of shelters) {
        const isNearest = nearest?.shelter.name === shelter.name;
        if (isNearest) continue;
        if (shelter.route && shelter.route.length > 1) {
          ctx.save();
          ctx.strokeStyle = isLight ? 'rgba(71, 85, 105, 0.45)' : 'rgba(100, 116, 139, 0.55)';
          ctx.lineWidth = 2;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          shelter.route.forEach(([rLat, rLon], idx) => {
            const p = viewport.project(rLat, rLon);
            if (idx === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
          ctx.restore();
        }
      }

      // Highlighted route to nearest shelter (walking polyline if present, else straight dashed line)
      if (nearest) {
        const targetPos = viewport.project(nearest.shelter.lat, nearest.shelter.lon);
        const routePts = nearest.shelter.route;
        if (routePts && routePts.length > 1) {
          ctx.save();
          ctx.strokeStyle = isLight ? '#0284C7' : '#38BDF8';
          ctx.lineWidth = 3.5;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          routePts.forEach(([rLat, rLon], idx) => {
            const p = viewport.project(rLat, rLon);
            if (idx === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.save();
          ctx.strokeStyle = isLight ? '#16A34A' : '#4ADE80';
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 6]);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(userPos.x, userPos.y);
          ctx.lineTo(targetPos.x, targetPos.y);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Draw shelters as green squares with names
      for (const shelter of shelters) {
        const pos = viewport.project(shelter.lat, shelter.lon);
        const isNearest = nearest?.shelter.name === shelter.name;
        const sqSize = isNearest ? 14 : 11;

        if (isNearest) {
          ctx.strokeStyle = isLight ? '#16A34A' : '#4ADE80';
          ctx.lineWidth = 1.75;
          ctx.strokeRect(
            pos.x - sqSize * 0.78,
            pos.y - sqSize * 0.78,
            sqSize * 1.56,
            sqSize * 1.56,
          );
        }

        ctx.fillStyle = isNearest ? '#16A34A' : '#15803D';
        ctx.fillRect(pos.x - sqSize / 2, pos.y - sqSize / 2, sqSize, sqSize);

        ctx.font = isNearest
          ? '700 11px "Plus Jakarta Sans", sans-serif'
          : '500 10px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = isLight
          ? isNearest
            ? '#0F172A'
            : '#334155'
          : isNearest
            ? '#E2E8F0'
            : '#94A3B8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const measuredW = ctx.measureText(shelter.name).width;
        const clampedX = Math.min(
          Math.max(measuredW / 2 + 6, pos.x),
          w - measuredW / 2 - 6,
        );
        const userBelowNearest = isNearest && userPos.y > pos.y && Math.abs(userPos.y - pos.y) < 55;
        const labelY = userBelowNearest
          ? Math.max(8, pos.y - sqSize / 2 - 18)
          : Math.min(pos.y + sqSize / 2 + 5, h - 18);
        ctx.fillText(shelter.name, clampedX, labelY);
      }

      // Distance + walk-time badge cleanly offset from markers
      if (nearest) {
        const targetPos = viewport.project(nearest.shelter.lat, nearest.shelter.lon);
        const distKm = nearest.shelter.route_km ?? nearest.distanceKm;
        const walkMin = nearest.shelter.route_min ?? estimateWalkMinutes(distKm);
        const distLabel = `${distKm.toFixed(2)} km · ~${walkMin}m`;
        ctx.font = '700 11px "JetBrains Mono", monospace';
        const textWidth = ctx.measureText(distLabel).width;
        const boxW = textWidth + 12;
        const boxH = 20;
        const dx = targetPos.x - userPos.x;
        const dy = targetPos.y - userPos.y;
        const segLen = Math.hypot(dx, dy);
        const midX = (userPos.x + targetPos.x) / 2;
        const midY = (userPos.y + targetPos.y) / 2;
        const bx =
          segLen < 72
            ? Math.min(w - boxW - 10, Math.max(userPos.x, targetPos.x) + 18)
            : Math.min(Math.max(8, midX - boxW / 2), w - boxW - 8);
        const by =
          segLen < 72
            ? Math.min(Math.max(10, midY - boxH / 2), h - boxH - 10)
            : Math.min(Math.max(8, midY - boxH / 2 - 14), h - boxH - 8);

        ctx.fillStyle = isLight ? '#15803D' : '#4ADE80';
        ctx.fillRect(bx, by, boxW, boxH);
        ctx.fillStyle = isLight ? '#FFFFFF' : '#052E16';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(distLabel, bx + boxW / 2, by + boxH / 2 + 0.5);
      }

      // GPS accuracy radius ring (if provided in meters)
      if (gpsAccuracyM && gpsAccuracyM > 0) {
        const accPx = (gpsAccuracyM / 1000) * viewport.pxPerKm;
        if (accPx > 8 && accPx < Math.min(w, h) * 0.45) {
          ctx.save();
          ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
          ctx.strokeStyle = 'rgba(96, 165, 250, 0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(userPos.x, userPos.y, accPx, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }

      // Draw user as a blue dot with crisp white border & halo
      ctx.fillStyle = 'rgba(59, 130, 246, 0.25)';
      ctx.beginPath();
      ctx.arc(userPos.x, userPos.y, 15, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(userPos.x, userPos.y, 8.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#2563EB';
      ctx.beginPath();
      ctx.arc(userPos.x, userPos.y, 6, 0, Math.PI * 2);
      ctx.fill();

      // Metric Scale Bar (bottom-left) + North indicator
      const { km: barKm, label: barLabel } = chooseScaleBarKm(viewport.pxPerKm, compact ? 76 : 110);
      const barPx = Math.max(24, barKm * viewport.pxPerKm);
      const barX = 10;
      const barY = h - 12;
      ctx.strokeStyle = isLight ? '#475569' : '#94A3B8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(barX, barY - 4);
      ctx.lineTo(barX, barY);
      ctx.lineTo(barX + barPx, barY);
      ctx.lineTo(barX + barPx, barY - 4);
      ctx.stroke();

      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillStyle = isLight ? '#1E293B' : '#CBD5E1';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(barLabel, barX, barY - 5);

      // North marker bottom-right
      ctx.fillStyle = isLight ? '#475569' : '#94A3B8';
      ctx.textAlign = 'right';
      ctx.fillText('N ↑', w - 10, h - 8);
    };

    render();
    const observer = new ResizeObserver(render);
    observer.observe(container);
    return () => observer.disconnect();
  }, [userLocation, shelters, region, gpsAccuracyM, compact, effectiveTheme]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        data-testid="schematic-map-canvas"
        aria-label="Offline metric schematic evacuation map showing user GPS location and nearest green shelter"
        className="absolute inset-0 block h-full w-full"
      />
    </div>
  );
}
