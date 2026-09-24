'use client';

import * as React from 'react';
import {
  PHOTO_BEARING,
  PHOTO_CATEGORY_LABEL,
  formatCoordinates,
  localOffsetMetres,
  type PhotoCategory,
} from '@/lib/site-inspection';

/**
 * A SCHEMATIC map of the site — not a map tile, and not survey data.
 *
 * No tile server is contacted and no GPS is read. The inspection location sits
 * at the centre of a local metric grid, and each photograph is plotted at its
 * (demo) offset from it, with an arrow for the direction the camera faced.
 * The scale is honest — the grid is in metres, computed from the coordinates
 * — and the caption says, every time, that the coordinates are demo values.
 */
export function SiteMap({
  latitude,
  longitude,
  photos,
  selectedId,
  onSelect,
  height = 280,
}: {
  latitude: number | null;
  longitude: number | null;
  photos: Array<{ id: string; category: string; latitude: number; longitude: number }>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  height?: number;
}) {
  const gradientId = React.useId();

  if (latitude == null || longitude == null) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-border bg-surface-sunk text-small text-text-muted"
        style={{ height }}
      >
        No inspection location recorded yet.
      </div>
    );
  }

  const centre = { latitude, longitude };
  const points = photos.map((p) => ({ ...p, ...localOffsetMetres(centre, p) }));

  // Fit the furthest photograph with a margin; never zoom in past a 40 m radius.
  const reach = Math.max(40, ...points.map((p) => Math.max(Math.abs(p.east), Math.abs(p.north)))) * 1.25;
  const W = 600;
  const H = 360;
  const scale = Math.min(W, H) / 2 / reach;
  const toX = (east: number) => W / 2 + east * scale;
  const toY = (north: number) => H / 2 - north * scale;

  const gridStep = niceStep(reach / 3);
  const gridLines: number[] = [];
  for (let m = -Math.ceil(reach / gridStep) * gridStep; m <= reach; m += gridStep) gridLines.push(m);

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-lg border border-border"
        style={{ height }}
        role="img"
        aria-label={`Schematic of the inspection location at ${formatCoordinates(latitude, longitude)} with ${photos.length} photograph positions`}
      >
        <defs>
          <radialGradient id={gradientId}>
            <stop offset="0" stopColor="hsl(95 35% 92%)" />
            <stop offset="1" stopColor="hsl(95 20% 84%)" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill={`url(#${gradientId})`} />

        {gridLines.map((m) => (
          <g key={m} stroke="hsl(95 15% 70%)" strokeWidth={m === 0 ? 0 : 0.6}>
            <line x1={toX(m)} y1={0} x2={toX(m)} y2={H} />
            <line x1={0} y1={toY(m)} x2={W} y2={toY(m)} />
          </g>
        ))}

        {/* The plot, drawn as a nominal 30 m square — schematic, not surveyed. */}
        <rect
          x={toX(-15)}
          y={toY(15)}
          width={30 * scale}
          height={30 * scale}
          fill="hsl(40 60% 88% / 0.7)"
          stroke="hsl(30 45% 45%)"
          strokeDasharray="6 4"
          strokeWidth={1.5}
        />

        {points.map((p) => {
          const x = toX(p.east);
          const y = toY(p.north);
          const bearing = PHOTO_BEARING[p.category as PhotoCategory];
          const active = p.id === selectedId;
          return (
            <g
              key={p.id}
              onClick={onSelect ? () => onSelect(p.id) : undefined}
              className={onSelect ? 'cursor-pointer' : undefined}
            >
              {bearing !== undefined && (
                <line
                  x1={x}
                  y1={y}
                  x2={x + Math.sin((bearing * Math.PI) / 180) * 22}
                  y2={y - Math.cos((bearing * Math.PI) / 180) * 22}
                  stroke="hsl(217 70% 40%)"
                  strokeWidth={2}
                />
              )}
              <circle
                cx={x}
                cy={y}
                r={active ? 9 : 7}
                fill={active ? 'hsl(217 90% 50%)' : 'hsl(217 70% 60%)'}
                stroke="white"
                strokeWidth={2}
              />
              <text x={x + 11} y={y + 4} fontSize={12} fill="hsl(220 25% 20%)" fontFamily="system-ui, sans-serif">
                {PHOTO_CATEGORY_LABEL[p.category as PhotoCategory] ?? p.category}
              </text>
            </g>
          );
        })}

        {/* The inspection location */}
        <g>
          <circle cx={W / 2} cy={H / 2} r={16} fill="hsl(0 80% 55% / 0.18)" />
          <circle cx={W / 2} cy={H / 2} r={6} fill="hsl(0 75% 48%)" stroke="white" strokeWidth={2} />
        </g>

        {/* North arrow and scale bar */}
        <g transform={`translate(${W - 32}, 34)`} fontFamily="system-ui, sans-serif">
          <path d="M0 -18 L7 6 L0 1 L-7 6 Z" fill="hsl(220 25% 20%)" />
          <text y={22} textAnchor="middle" fontSize={12} fontWeight={700} fill="hsl(220 25% 20%)">
            N
          </text>
        </g>
        <g transform={`translate(16, ${H - 18})`} fontFamily="system-ui, sans-serif">
          <line x1={0} y1={0} x2={gridStep * scale} y2={0} stroke="hsl(220 25% 20%)" strokeWidth={2} />
          <text x={0} y={-6} fontSize={11} fill="hsl(220 25% 20%)">
            {gridStep} m
          </text>
        </g>
      </svg>
      <figcaption className="text-caption text-text-muted">
        <span className="font-medium text-text">{formatCoordinates(latitude, longitude)}</span> — DEMO
        coordinates. Schematic only: no GPS was read and no map service was used. The dashed square is a
        nominal plot outline, not the surveyed boundary.
      </figcaption>
    </figure>
  );
}

function niceStep(raw: number): number {
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  return steps.find((s) => s >= raw) ?? 1000;
}
