"use client";

import React, { useState, useRef, useLayoutEffect, useEffect, useId, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';

export interface TrendPoint {
  id: string;
  name: string;
  environment: string;
  passRate: number;
  pass: number;
  fail: number;
  pending: number;
  invalid?: number;
  total: number;
  date: string;
  createdAt?: string;
  completedAt?: string | null;
  startedAt?: string | null;
}

export type TimePeriod = '1w' | '2w' | '1m' | '3m' | '6m' | '1y' | 'All';

// Layout effect on the client (measures before paint), plain effect during SSR.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const PERIODS: { key: TimePeriod; label: string; days?: number }[] = [
  { key: '1w', label: '1w', days: 7 },
  { key: '2w', label: '2w', days: 14 },
  { key: '1m', label: '1m', days: 30 },
  { key: '3m', label: '3m', days: 90 },
  { key: '6m', label: '6m', days: 180 },
  { key: '1y', label: '1y', days: 365 },
  { key: 'All', label: 'All' },
];

const PERIOD_NAMES: Record<TimePeriod, string> = {
  '1w': 'the last week',
  '2w': 'the last 2 weeks',
  '1m': 'the last month',
  '3m': 'the last 3 months',
  '6m': 'the last 6 months',
  '1y': 'the last year',
  'All': 'project history',
};

function filterRunsByPeriod(allData: TrendPoint[], period: TimePeriod): TrendPoint[] {
  if (period === 'All') return allData;
  const periodConf = PERIODS.find((p) => p.key === period);
  if (!periodConf?.days) return allData;

  const cutoff = Date.now() - periodConf.days * 24 * 60 * 60 * 1000;
  return allData.filter((d) => {
    const rawDate = d.startedAt || d.createdAt || d.completedAt || d.date;
    if (!rawDate) return true;
    const time = new Date(rawDate).getTime();
    return time >= cutoff;
  });
}

function getBestInitialPeriod(allData: TrendPoint[], preferred?: TimePeriod): TimePeriod {
  if (preferred && filterRunsByPeriod(allData, preferred).length >= 2) {
    return preferred;
  }
  for (const p of PERIODS) {
    if (filterRunsByPeriod(allData, p.key).length >= 2) {
      return p.key;
    }
  }
  return 'All';
}

interface QualityTrendChartProps {
  data: TrendPoint[];
  height?: number;
  onSelectRun?: (runId: string) => void;
  className?: string;
  defaultPeriod?: TimePeriod;
}

export function QualityTrendChart({
  data = [],
  height = 200,
  onSelectRun,
  className,
  defaultPeriod,
}: QualityTrendChartProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>(() =>
    getBestInitialPeriod(data, defaultPeriod)
  );
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  // `null` until the real layout width is known: the chart stays invisible so it
  // never paints at a guessed width and then jumps/slides into place.
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const chartId = useId();

  // Filter dataset by chosen time-period based on execution date
  const filteredData = useMemo(
    () => filterRunsByPeriod(data, selectedPeriod),
    [data, selectedPeriod]
  );

  // The measured chart area only exists once there are at least 2 points to plot.
  const chartMounted = filteredData.length >= 2;

  // Measure the exact SVG container synchronously (before paint) and keep it in
  // sync on resize. Re-runs when the chart area mounts after the sparse state.
  useIsomorphicLayoutEffect(() => {
    if (!chartMounted) return;
    const el = chartAreaRef.current;
    if (!el) return;

    const measure = () => {
      const width = el.clientWidth;
      if (width > 0) {
        setContainerWidth((prev) => (prev === width ? prev : width));
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chartMounted]);

  // Find the nearest wider timeframe that has >= 2 runs for one-click widening
  const nextValidPeriod = useMemo(() => {
    for (const p of PERIODS) {
      const count = filterRunsByPeriod(data, p.key).length;
      if (count >= 2 && p.key !== selectedPeriod) {
        return { key: p.key, label: p.label, count };
      }
    }
    return null;
  }, [data, selectedPeriod]);

  // Sort chronological execution order for sequential run-by-run progression
  const sortedRuns = useMemo(() => {
    return [...filteredData].sort((a, b) => {
      const tA = new Date(a.startedAt || a.createdAt || a.completedAt || a.date).getTime();
      const tB = new Date(b.startedAt || b.createdAt || b.completedAt || b.date).getTime();
      return tA - tB;
    });
  }, [filteredData]);

  // Dynamic period metrics
  const periodStats = useMemo(() => {
    if (sortedRuns.length === 0) return { avg: 0, count: 0, latest: 0 };
    const avg = Math.round(
      sortedRuns.reduce((acc, d) => acc + d.passRate, 0) / sortedRuns.length
    );
    const latest = sortedRuns[sortedRuns.length - 1].passRate;
    return { avg, count: sortedRuns.length, latest };
  }, [sortedRuns]);

  // Layout Bounds
  const viewWidth = Math.max(containerWidth ?? 0, 320);
  const viewHeight = height;
  const paddingLeft = 44;
  const paddingRight = 32;
  const paddingTop = 26;
  const paddingBottom = 34;

  const chartWidth = Math.max(viewWidth - paddingLeft - paddingRight, 100);
  const chartHeight = Math.max(viewHeight - paddingTop - paddingBottom, 60);

  // Map each run sequentially to distinct, evenly-spaced X positions (Option 1: Run-by-Run)
  const mappedPoints = useMemo(() => {
    const N = sortedRuns.length;
    if (N === 0) return [];

    if (N === 1) {
      const d = sortedRuns[0];
      const clampedRate = Math.min(Math.max(d.passRate, 0), 100);
      return [
        {
          ...d,
          clampedRate,
          index: 0,
          x: paddingLeft + chartWidth / 2,
          y: paddingTop + chartHeight - (clampedRate / 100) * chartHeight,
        },
      ];
    }

    // Side margin so the first and last run points have breathing room and aren't clipped on edges
    const sideMargin = Math.min(chartWidth * 0.08, 48);
    const usableWidth = chartWidth - sideMargin * 2;

    return sortedRuns.map((d, index) => {
      const x = paddingLeft + sideMargin + (index / (N - 1)) * usableWidth;
      const clampedRate = Math.min(Math.max(d.passRate, 0), 100);
      const y = paddingTop + chartHeight - (clampedRate / 100) * chartHeight;

      return {
        ...d,
        clampedRate,
        index,
        x,
        y,
      };
    });
  }, [sortedRuns, chartWidth, chartHeight, paddingLeft, paddingTop]);

  // Sequential SVG Line & Area Path Calculation
  const { linePath, areaPath } = useMemo(() => {
    if (mappedPoints.length === 0) return { linePath: '', areaPath: '' };

    const bottomY = paddingTop + chartHeight;

    if (mappedPoints.length === 1) {
      return { linePath: '', areaPath: '' };
    }

    const line = mappedPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');

    const firstPt = mappedPoints[0];
    const lastPt = mappedPoints[mappedPoints.length - 1];
    const area = `${line} L ${lastPt.x.toFixed(1)} ${bottomY.toFixed(1)} L ${firstPt.x.toFixed(1)} ${bottomY.toFixed(1)} Z`;

    return { linePath: line, areaPath: area };
  }, [mappedPoints, paddingTop, chartHeight]);

  // Y-Axis reference levels
  const yTicks = [100, 75, 50, 25, 0];

  const activePoint = hoveredIndex !== null ? mappedPoints[hoveredIndex] : null;

  // Tooltip positioning & boundary flipping
  const isNearTop = activePoint ? activePoint.y < paddingTop + chartHeight * 0.45 : false;
  const isNearLeft = activePoint ? activePoint.x < 140 : false;
  const isNearRight = activePoint ? activePoint.x > viewWidth - 140 : false;

  let tooltipTranslate = '-translate-x-1/2';
  if (isNearLeft) tooltipTranslate = 'translate-x-0';
  else if (isNearRight) tooltipTranslate = '-translate-x-full';

  if (!data || data.length === 0) {
    return (
      <div className="py-12 text-center text-xs text-muted-foreground border border-border/40 rounded-xl bg-muted/20">
        No completed test run history available to plot trend curve.
      </div>
    );
  }

  return (
    <div className={cn("space-y-3 w-full select-none", className)}>
      {/* ── 1. Time-Period Filter Pills + Period Stats ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap pb-1">
        <div className="inline-flex items-center rounded-xl border border-border/50 bg-muted/40 p-1 text-xs font-medium">
          {PERIODS.map((p) => {
            const isSelected = selectedPeriod === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  setSelectedPeriod(p.key);
                  setHoveredIndex(null);
                }}
                className={cn(
                  "px-2.5 py-1 rounded-lg transition-all cursor-pointer font-mono text-[11px]",
                  isSelected
                    ? "bg-primary text-primary-foreground font-bold shadow-xs"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {sortedRuns.length >= 2 && selectedPeriod !== 'All' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {periodStats.count} of {data.length} runs in window · Avg:{' '}
              <strong className="text-emerald-500 font-mono font-semibold">
                {periodStats.avg}%
              </strong>
            </span>
          </div>
        )}
      </div>

      {/* ── 2. Chart or Sparse / Empty State for Filtered Period (< 2 points) ── */}
      {sortedRuns.length < 2 ? (
        <div className="py-10 px-4 text-center rounded-2xl bg-muted/20 border border-border/40 space-y-3">
          {sortedRuns.length === 1 && (() => {
            const singleRun = sortedRuns[0];
            return (
              <div className="flex justify-center pb-1">
                <div
                  onClick={() => onSelectRun?.(singleRun.id)}
                  className={cn(
                    "inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-card border border-border/60 shadow-xs text-xs",
                    onSelectRun && "cursor-pointer hover:border-primary/40 transition-colors group"
                  )}
                >
                  <span className="font-mono font-bold text-primary">{singleRun.id}</span>
                  <span className="font-medium text-foreground truncate max-w-[200px] group-hover:text-primary transition-colors">
                    {singleRun.name}
                  </span>
                  <span className="text-muted-foreground/50">·</span>
                  <span className="font-mono text-muted-foreground">{singleRun.date}</span>
                  <span className="text-muted-foreground/50">·</span>
                  <span
                    className={cn(
                      "font-mono font-bold",
                      singleRun.passRate >= 80
                        ? "text-emerald-400"
                        : singleRun.passRate >= 50
                        ? "text-amber-400"
                        : "text-rose-400"
                    )}
                  >
                    {singleRun.passRate}% ({singleRun.pass}/{singleRun.total})
                  </span>
                  {onSelectRun && (
                    <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" />
                  )}
                </div>
              </div>
            );
          })()}

          <div className="space-y-1 max-w-md mx-auto">
            <p className="text-xs font-medium text-foreground">
              {sortedRuns.length === 1
                ? `Only 1 completed run in ${PERIOD_NAMES[selectedPeriod]}`
                : `No completed runs recorded in ${PERIOD_NAMES[selectedPeriod]}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {data.length >= 2
                ? 'At least 2 completed runs are needed to plot a trend line. Widen the timeframe to view your run history.'
                : 'Complete at least 2 test runs to plot a pass rate trend over time.'}
            </p>
          </div>

          {nextValidPeriod && (
            <div className="flex items-center justify-center gap-2 pt-1.5">
              {nextValidPeriod.key !== 'All' && (
                <button
                  type="button"
                  onClick={() => setSelectedPeriod(nextValidPeriod.key)}
                  className="h-8 px-3 rounded-xl border border-primary/40 bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors cursor-pointer"
                >
                  Show {nextValidPeriod.label} ({nextValidPeriod.count} runs)
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedPeriod('All')}
                className={cn(
                  "h-8 px-3 rounded-xl border text-xs font-semibold transition-colors cursor-pointer",
                  nextValidPeriod.key === 'All'
                    ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                    : "border-border/60 hover:bg-muted text-foreground"
                )}
              >
                View All History ({data.length} runs)
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="relative w-full rounded-2xl bg-muted/20 border border-border/40 p-2 sm:p-3">
          <div
            ref={chartAreaRef}
            className="relative w-full"
            style={{
              height: viewHeight,
              // Never paint the guessed-width chart; wait for the layout measurement.
              opacity: containerWidth === null ? 0 : 1,
            }}
          >
            <svg
              className="w-full h-full"
              viewBox={`0 0 ${viewWidth} ${viewHeight}`}
            >
              <defs>
                <linearGradient id={`gradient-${chartId}`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.22" />
                  <stop offset="90%" stopColor="hsl(var(--primary))" stopOpacity="0.02" />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Y-Axis Horizontal Grid Lines & Labels */}
              {yTicks.map((val) => {
                const yPos = paddingTop + chartHeight - (val / 100) * chartHeight;
                return (
                  <g key={val}>
                    <line
                      x1={paddingLeft}
                      y1={yPos}
                      x2={paddingLeft + chartWidth}
                      y2={yPos}
                      stroke="currentColor"
                      strokeOpacity={val === 0 || val === 100 ? 0.16 : 0.08}
                      strokeDasharray={val === 0 || val === 100 ? undefined : "3 3"}
                    />
                    <text
                      x={paddingLeft - 8}
                      y={yPos + 3.5}
                      textAnchor="end"
                      className="text-[10px] font-mono fill-muted-foreground/60 font-medium"
                    >
                      {val}%
                    </text>
                  </g>
                );
              })}

              {/* Sequential Run-by-Run X-Axis Labels */}
              {mappedPoints.map((pt, i) => {
                // If there are many runs, show alternate labels to avoid text collision
                const skipLabel = mappedPoints.length > 8 && i % 2 !== 0 && i !== mappedPoints.length - 1;
                if (skipLabel) return null;

                const labelText = mappedPoints.length <= 6
                  ? `${pt.id ? `${pt.id} · ` : ''}${pt.date}`
                  : pt.id || pt.date;

                return (
                  <g key={`xtick-${pt.id}-${i}`}>
                    <line
                      x1={pt.x}
                      y1={paddingTop + chartHeight}
                      x2={pt.x}
                      y2={paddingTop + chartHeight + 4}
                      stroke="currentColor"
                      strokeOpacity={0.2}
                    />
                    <text
                      x={pt.x}
                      y={paddingTop + chartHeight + 17}
                      textAnchor="middle"
                      className="text-[10px] font-mono fill-muted-foreground/70 select-none font-medium"
                    >
                      {labelText}
                    </text>
                  </g>
                );
              })}

              {/* Single Run Milestone Callout: Center Drop-line and Reference Pill */}
              {mappedPoints.length === 1 && (
                <g>
                  <line
                    x1={mappedPoints[0].x}
                    y1={mappedPoints[0].y}
                    x2={mappedPoints[0].x}
                    y2={paddingTop + chartHeight}
                    stroke="hsl(var(--primary))"
                    strokeOpacity={0.35}
                    strokeDasharray="3 3"
                  />
                  {/* Outer pulse halo for single point milestone */}
                  <circle
                    cx={mappedPoints[0].x}
                    cy={mappedPoints[0].y}
                    r="14"
                    fill="hsl(var(--primary))"
                    fillOpacity="0.15"
                    className="animate-pulse pointer-events-none"
                  />
                </g>
              )}

              {/* Area Fill Underneath Sequential Line */}
              {areaPath && <path d={areaPath} fill={`url(#gradient-${chartId})`} />}

              {/* Sequential Line Path (Strictly connects actual executed runs in order) */}
              {linePath && (
                <path
                  d={linePath}
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Active Vertical Crosshair Line */}
              {activePoint && (
                <line
                  x1={activePoint.x}
                  y1={paddingTop}
                  x2={activePoint.x}
                  y2={paddingTop + chartHeight}
                  stroke="hsl(var(--primary))"
                  strokeWidth="1.5"
                  strokeDasharray="2 2"
                  strokeOpacity={0.8}
                  className="transition-opacity duration-150"
                />
              )}

              {/* Sequential Run Points */}
              {mappedPoints.map((pt, i) => {
                const isActive = hoveredIndex === i;
                const pointColor = pt.passRate >= 80 ? '#10b981' : pt.passRate >= 50 ? '#f59e0b' : '#f43f5e';

                return (
                  <g key={`pt-${pt.id}-${i}`}>
                    {/* Generous invisible hover hit-target */}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r="20"
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredIndex(i)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      onClick={() => onSelectRun?.(pt.id)}
                    />

                    {/* Animated Halo on Hover */}
                    {isActive && (
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r="12"
                        fill={pointColor}
                        fillOpacity="0.25"
                        className="animate-pulse pointer-events-none"
                      />
                    )}

                    {/* Point Circle */}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isActive ? 6 : 4.5}
                      fill="hsl(var(--card))"
                      stroke={pointColor}
                      strokeWidth={isActive ? 3 : 2.25}
                      className="transition-[r,stroke-width] duration-150 pointer-events-none"
                    />

                    {isActive && (
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r="2.5"
                        fill={pointColor}
                        className="pointer-events-none"
                      />
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Unclipped Floating Tooltip with Flipped Top/Bottom Logic */}
            {activePoint && (
              <div
                style={{
                  left: activePoint.x,
                  top: isNearTop ? activePoint.y + 12 : activePoint.y - 12,
                }}
                className={cn(
                  "absolute z-40 transition-opacity duration-100 pointer-events-auto",
                  tooltipTranslate,
                  isNearTop ? "translate-y-0" : "-translate-y-full"
                )}
                onMouseEnter={() => setHoveredIndex(hoveredIndex)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <div
                  onClick={() => onSelectRun?.(activePoint.id)}
                  className="w-60 p-2.5 rounded-xl bg-[#121622]/95 border border-white/15 shadow-2xl backdrop-blur-xl text-left space-y-1.5 cursor-pointer hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-center justify-between border-b border-white/10 pb-1 gap-1">
                    <span className="text-[11px] font-semibold text-slate-100 truncate max-w-[140px]" title={activePoint.name}>
                      {activePoint.id}: {activePoint.name}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/10 text-slate-300 font-medium shrink-0">
                      {activePoint.environment}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-0.5">
                    <span className="text-[11px] text-slate-300">Pass Rate</span>
                    <span
                      className={cn(
                        "text-sm font-bold font-mono",
                        activePoint.passRate >= 80 ? "text-emerald-400" : activePoint.passRate >= 50 ? "text-amber-400" : "text-rose-400"
                      )}
                    >
                      {activePoint.passRate}%
                    </span>
                  </div>

                  <div className="text-[10px] text-slate-300 flex items-center justify-between gap-1 pt-0.5 font-mono">
                    <span className="text-emerald-400 font-medium">{activePoint.pass} passed</span>
                    <span>·</span>
                    <span className={activePoint.fail > 0 ? "text-rose-400 font-medium" : "text-slate-400"}>
                      {activePoint.fail} failed
                    </span>
                    {activePoint.invalid !== undefined && activePoint.invalid > 0 && (
                      <>
                        <span>·</span>
                        <span className="text-purple-400">{activePoint.invalid} invalid</span>
                      </>
                    )}
                    <span>·</span>
                    <span className="text-slate-400">{activePoint.total} total</span>
                  </div>

                  <div className="pt-1 border-t border-white/10 text-[9px] text-slate-400 flex items-center justify-between">
                    <span>
                      {activePoint.date}
                    </span>
                    <span className="text-primary font-medium flex items-center gap-0.5 hover:underline">
                      Inspect run <ExternalLink className="w-2.5 h-2.5 ml-0.5 inline" />
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
