'use client';

import * as React from 'react';
import { Maximize2, Ruler, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { IfcFacts } from '@/lib/bim';
import type { BimModelRow, BimPayload, BimVersionRow } from './types';

type ViewerProps = {
  applicationNumber: string;
  model: BimModelRow | null;
  activeVersion: BimVersionRow | null;
  facts: IfcFacts | null;
  readiness: BimPayload['readiness'];
};

type Point = { x: number; y: number };

const DEMO_MODELS = [
  { id: 'courtyard', name: 'Courtyard Residence', width: 2.45, depth: 1.8, color: '#4d6077', accent: '#3e566f', spaces: 8 },
  { id: 'rowhouse', name: 'Urban Row House', width: 1.8, depth: 2.35, color: '#6b5a4c', accent: '#57483e', spaces: 6 },
  { id: 'corner', name: 'Corner Duplex', width: 2.85, depth: 1.55, color: '#486b69', accent: '#355655', spaces: 10 },
] as const;

export function BimViewer({ applicationNumber, activeVersion, facts, readiness }: ViewerProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const sceneRef = React.useRef<HTMLDivElement>(null);
  const [rotation, setRotation] = React.useState({ x: -0.38, y: 0.62 });
  const [zoom, setZoom] = React.useState(1);
  const [dragging, setDragging] = React.useState(false);
  const [measureMode, setMeasureMode] = React.useState(false);
  const [selectedLevel, setSelectedLevel] = React.useState<number | null>(null);
  const [selectedDemo, setSelectedDemo] = React.useState(0);
  const dragStart = React.useRef({ x: 0, y: 0 });

  const demo = DEMO_MODELS[selectedDemo] ?? DEMO_MODELS[0];
  const floors = 2;
  const floorNames = facts?.storeys.length === 2 ? facts.storeys : [
    { name: 'Ground Floor', elevationM: 0 },
    { name: 'First Floor', elevationM: 3.2 },
  ];
  const violations = readiness.checks.filter((check) => check.status === 'FAIL').length;
  const walls = facts?.counts.IFCWALL || 24;
  const spaces = facts?.counts.IFCSPACE || demo.spaces;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    if (!canvas || !scene) return;

    const draw = () => {
      const bounds = scene.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(bounds.width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(bounds.height * pixelRatio));
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);
      context.fillStyle = '#090e1a';
      context.fillRect(0, 0, bounds.width, bounds.height);

      const center = { x: bounds.width * 0.5, y: bounds.height * 0.58 };
      const scale = Math.min(bounds.width, bounds.height) * 0.2 * zoom;
      const baseWidth = demo.width;
      const baseDepth = demo.depth;
      const floorHeight = Math.max(0.35, 4.2 / floors);
      const project = (point: { x: number; y: number; z: number }): Point => {
        const yawX = point.x * Math.cos(rotation.y) - point.z * Math.sin(rotation.y);
        const yawZ = point.x * Math.sin(rotation.y) + point.z * Math.cos(rotation.y);
        const pitchY = point.y * Math.cos(rotation.x) - yawZ * Math.sin(rotation.x);
        return { x: center.x + yawX * scale, y: center.y - pitchY * scale };
      };
      const polygon = (points: Point[], fill: string, stroke = '#233149') => {
        context.beginPath();
        points.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
        context.closePath();
        context.fillStyle = fill;
        context.fill();
        context.strokeStyle = stroke;
        context.lineWidth = 1;
        context.stroke();
      };

      context.strokeStyle = '#15243a';
      context.lineWidth = 1;
      for (let line = -8; line <= 8; line += 1) {
        const start = project({ x: line, y: 0, z: -8 });
        const end = project({ x: line, y: 0, z: 8 });
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
        const crossStart = project({ x: -8, y: 0, z: line });
        const crossEnd = project({ x: 8, y: 0, z: line });
        context.beginPath();
        context.moveTo(crossStart.x, crossStart.y);
        context.lineTo(crossEnd.x, crossEnd.y);
        context.stroke();
      }

      const setback = [
        project({ x: -3.2, y: 0.02, z: -2.4 }),
        project({ x: 3.2, y: 0.02, z: -2.4 }),
        project({ x: 3.2, y: 0.02, z: 2.4 }),
        project({ x: -3.2, y: 0.02, z: 2.4 }),
      ];
      polygon(setback, 'rgba(244, 194, 13, 0.05)', '#e6c21a');

      for (let level = 0; level < floors; level += 1) {
        const bottom = level * floorHeight;
        const top = bottom + floorHeight * 0.9;
        const levelColor = selectedLevel === level ? '#c73838' : level % 2 ? demo.accent : demo.color;
        const front = [
          project({ x: -baseWidth, y: bottom, z: baseDepth }),
          project({ x: baseWidth, y: bottom, z: baseDepth }),
          project({ x: baseWidth, y: top, z: baseDepth }),
          project({ x: -baseWidth, y: top, z: baseDepth }),
        ];
        const side = [
          project({ x: baseWidth, y: bottom, z: baseDepth }),
          project({ x: baseWidth, y: bottom, z: -baseDepth }),
          project({ x: baseWidth, y: top, z: -baseDepth }),
          project({ x: baseWidth, y: top, z: baseDepth }),
        ];
        polygon(front, levelColor);
        polygon(side, level % 2 ? '#2c4058' : '#344a63');
        context.strokeStyle = '#a6b7c9';
        context.globalAlpha = 0.42;
        for (let opening = -0.65; opening <= 0.65; opening += 0.65) {
          const windowBottom = project({ x: opening, y: bottom + floorHeight * 0.28, z: baseDepth + 0.01 });
          const windowTop = project({ x: opening, y: bottom + floorHeight * 0.7, z: baseDepth + 0.01 });
          context.beginPath();
          context.moveTo(windowBottom.x, windowBottom.y);
          context.lineTo(windowTop.x, windowTop.y);
          context.stroke();
        }
        context.globalAlpha = 1;
      }

      const roof = [
        project({ x: -baseWidth - 0.1, y: floors * floorHeight, z: baseDepth + 0.1 }),
        project({ x: baseWidth + 0.1, y: floors * floorHeight, z: baseDepth + 0.1 }),
        project({ x: baseWidth + 0.1, y: floors * floorHeight, z: -baseDepth - 0.1 }),
        project({ x: -baseWidth - 0.1, y: floors * floorHeight, z: -baseDepth - 0.1 }),
      ];
      polygon(roof, '#26384e', '#52667c');
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(scene);
    return () => observer.disconnect();
  }, [demo, facts, floors, rotation, selectedLevel, zoom, walls]);

  const reset = () => {
    setRotation({ x: -0.38, y: 0.62 });
    setZoom(1);
    setSelectedLevel(null);
    setSelectedDemo(0);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void sceneRef.current?.requestFullscreen();
  };

  return (
    <section className="overflow-hidden rounded-lg border border-[#26344b] bg-[#090e1a] text-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#26344b] px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold"><span className="rounded bg-cyan-400/15 px-1.5 py-1 text-cyan-300">BIM</span> Digital Permit Workspace</p>
          <p className="truncate text-xs text-slate-400">Ref: {applicationNumber} · {activeVersion?.file.originalName ?? 'Demo model workspace'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={violations ? 'danger' : 'success'}>{violations ? `${violations} DCR shortfalls` : 'DCR checks clear'}</Badge>
          <span className="text-xs text-slate-400">{facts?.schema ?? 'Awaiting IFC'}</span>
        </div>
      </div>
      <div className="grid lg:grid-cols-[1fr_15rem]">
        <div
          ref={sceneRef}
          className="relative min-h-[26rem] select-none overflow-hidden bg-[#090e1a]"
          onPointerDown={(event) => {
            setDragging(true);
            dragStart.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!dragging) return;
            const deltaX = event.clientX - dragStart.current.x;
            const deltaY = event.clientY - dragStart.current.y;
            dragStart.current = { x: event.clientX, y: event.clientY };
            setRotation((current) => ({ x: Math.max(-1.1, Math.min(0.2, current.x + deltaY * 0.008)), y: current.y + deltaX * 0.008 }));
          }}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onWheel={(event) => setZoom((current) => Math.max(0.65, Math.min(1.8, current - event.deltaY * 0.0008)))}
        >
          <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-label="Interactive BIM model viewer" />
          <div className="absolute left-3 top-3 flex items-center gap-2"><Badge tone="outline">{activeVersion ? `V${activeVersion.versionNo} · IFC4 Reference View` : 'Interactive demo model'}</Badge></div>
          <div className="absolute bottom-3 left-3 rounded border border-[#314158] bg-[#0d1625]/90 px-3 py-2 text-[11px] text-slate-300">
            <p><span className="mr-1 inline-block size-2 rounded-full bg-yellow-400" />Cadastral plot boundary</p>
            <p><span className="mr-1 inline-block size-2 rounded-full bg-cyan-400" />Required setback envelope</p>
            <p><span className="mr-1 inline-block size-2 rounded-full bg-red-400" />Selected level / shortfall</p>
          </div>
          <div className="absolute right-3 top-3 flex gap-1.5">
            <Button size="icon" variant="ghost" className="border border-[#314158] bg-[#0d1625]/90 text-slate-200 hover:bg-[#17243a]" aria-label="Reset view" onClick={reset}><RotateCcw className="size-4" /></Button>
            <Button size="icon" variant={measureMode ? 'primary' : 'ghost'} className="border border-[#314158] bg-[#0d1625]/90 text-slate-200 hover:bg-[#17243a]" aria-label="Measure model" onClick={() => setMeasureMode((current) => !current)}><Ruler className="size-4" /></Button>
            <Button size="icon" variant="ghost" className="border border-[#314158] bg-[#0d1625]/90 text-slate-200 hover:bg-[#17243a]" aria-label="Fullscreen viewer" onClick={toggleFullscreen}><Maximize2 className="size-4" /></Button>
          </div>
          <div className="absolute bottom-3 right-3 flex gap-1.5">
            <Button size="icon" variant="ghost" className="border border-[#314158] bg-[#0d1625]/90 text-slate-200 hover:bg-[#17243a]" aria-label="Zoom out" onClick={() => setZoom((current) => Math.max(0.65, current - 0.12))}><ZoomOut className="size-4" /></Button>
            <Button size="icon" variant="ghost" className="border border-[#314158] bg-[#0d1625]/90 text-slate-200 hover:bg-[#17243a]" aria-label="Zoom in" onClick={() => setZoom((current) => Math.min(1.8, current + 0.12))}><ZoomIn className="size-4" /></Button>
          </div>
        </div>
        <aside className="border-t border-[#26344b] bg-[#0d1625] p-4 lg:border-l lg:border-t-0">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Model inspection</p>
          <div className="mb-4 grid gap-1.5">{DEMO_MODELS.map((item, index) => <button key={item.id} type="button" className={cn('rounded border px-2.5 py-2 text-left text-xs transition-colors', selectedDemo === index ? 'border-cyan-400/70 bg-cyan-400/10 text-cyan-100' : 'border-[#314158] text-slate-300 hover:bg-[#17243a]')} onClick={() => { setSelectedDemo(index); setSelectedLevel(null); }}>{item.name}<span className="mt-0.5 block text-[10px] text-slate-500">Two floors · {item.spaces} spaces</span></button>)}</div>
          <dl className="space-y-3 text-xs"><Detail label="Model type" value="Demo IFC building" /><Detail label="Storeys" value="2" /><Detail label="Walls" value={walls.toLocaleString('en-IN')} /><Detail label="Spaces" value={spaces.toLocaleString('en-IN')} /><Detail label="Review score" value={`${readiness.score}%`} valueClass={readiness.ready ? 'text-emerald-300' : 'text-amber-300'} /></dl>
          <div className="mt-6 border-t border-[#26344b] pt-4">
            <p className="mb-2 text-xs font-semibold text-slate-300">Levels</p>
            <div className="space-y-1.5">{floorNames.length ? floorNames.map((level, index) => <button key={`${level.name}-${index}`} type="button" className={cn('flex w-full items-center justify-between rounded px-2.5 py-2 text-left text-xs transition-colors', selectedLevel === index ? 'bg-red-500/20 text-red-200' : 'text-slate-300 hover:bg-[#17243a]')} onClick={() => setSelectedLevel(selectedLevel === index ? null : index)}><span className="truncate">{level.name}</span><span className="text-slate-500">{level.elevationM === null ? '—' : `${level.elevationM} m`}</span></button>) : <p className="text-xs text-slate-500">No storeys parsed from this IFC.</p>}</div>
          </div>
          {measureMode && <p className="mt-5 rounded border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-2 text-xs text-cyan-200">Measure mode active. Select a level to inspect its elevation and area.</p>}
        </aside>
      </div>
      <div className="grid border-t border-[#26344b] bg-[#0d1625] sm:grid-cols-4"><Metric label="Total evaluated" value={String(readiness.checks.length)} /><Metric label="Violations (fail)" value={String(violations)} tone={violations ? 'danger' : 'success'} /><Metric label="Compliant (pass)" value={String(readiness.checks.filter((check) => check.status === 'PASS').length)} tone="success" /><Metric label="Warnings" value={String(readiness.checks.filter((check) => check.status === 'WARN').length)} tone="warning" /></div>
    </section>
  );
}

function Detail({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">{label}</dt><dd className={cn('font-medium text-slate-200', valueClass)}>{value}</dd></div>;
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' | 'success' | 'warning' }) {
  const color = tone === 'danger' ? 'text-red-300' : tone === 'success' ? 'text-emerald-300' : tone === 'warning' ? 'text-amber-300' : 'text-white';
  return <div className="border-b border-[#26344b] px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><p className="text-[11px] text-slate-500">{label}</p><p className={cn('mt-1 text-xl font-semibold tabular-nums', color)}>{value}</p></div>;
}