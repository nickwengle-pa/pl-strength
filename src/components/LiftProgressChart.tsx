import React, { useEffect, useState } from "react";
import { recentSessions, type SessionRecord } from "../lib/db";

type Lift = "bench" | "squat" | "deadlift";

type ChartDataPoint = {
  date: Date;
  est1rm: number;
  pr: boolean;
  week: number;
};

const LIFT_LABELS: Record<Lift, string> = {
  bench: "Bench Press",
  squat: "Back Squat",
  deadlift: "Deadlift",
};

const LIFT_COLORS: Record<Lift, { line: string; fill: string; pr: string }> = {
  bench: { line: "#3b82f6", fill: "#dbeafe", pr: "#f59e0b" },
  squat: { line: "#10b981", fill: "#d1fae5", pr: "#f59e0b" },
  deadlift: { line: "#8b5cf6", fill: "#ede9fe", pr: "#f59e0b" },
};

type Props = {
  lift: Lift;
  unit: "lb" | "kg";
};

export default function LiftProgressChart({ lift, unit }: Props) {
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const sessions = await recentSessions(lift, 50);
      const points: ChartDataPoint[] = sessions
        .filter((s) => s.est1rm && s.createdAt)
        .map((s) => ({
          date: new Date(s.createdAt!),
          est1rm: s.est1rm,
          pr: s.pr || false,
          week: s.week,
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      setData(points);
      setLoading(false);
    })();
  }, [lift]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 h-48 flex items-center justify-center">
        <div className="text-sm text-gray-500">Loading {LIFT_LABELS[lift]}...</div>
      </div>
    );
  }

  if (data.length < 2) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-gray-900">{LIFT_LABELS[lift]}</h3>
        </div>
        <div className="h-32 flex items-center justify-center text-sm text-gray-500">
          Log more sessions to see your progress chart
        </div>
      </div>
    );
  }

  const colors = LIFT_COLORS[lift];
  const minEst = Math.min(...data.map((d) => d.est1rm));
  const maxEst = Math.max(...data.map((d) => d.est1rm));
  const range = maxEst - minEst || 1;
  const padding = range * 0.1;
  const yMin = Math.floor(minEst - padding);
  const yMax = Math.ceil(maxEst + padding);
  const yRange = yMax - yMin || 1;

  const chartWidth = 300;
  const chartHeight = 120;
  const paddingLeft = 40;
  const paddingRight = 10;
  const paddingTop = 10;
  const paddingBottom = 30;
  const graphWidth = chartWidth - paddingLeft - paddingRight;
  const graphHeight = chartHeight - paddingTop - paddingBottom;

  const xScale = (index: number) =>
    paddingLeft + (index / (data.length - 1)) * graphWidth;
  const yScale = (value: number) =>
    paddingTop + graphHeight - ((value - yMin) / yRange) * graphHeight;

  // Build path
  const pathPoints = data.map((d, i) => `${xScale(i)},${yScale(d.est1rm)}`);
  const linePath = `M ${pathPoints.join(" L ")}`;
  
  // Area fill path
  const areaPath = `M ${paddingLeft},${yScale(yMin)} L ${pathPoints.join(" L ")} L ${xScale(data.length - 1)},${yScale(yMin)} Z`;

  // Y-axis labels
  const yLabels = [yMin, Math.round((yMin + yMax) / 2), yMax];

  // Date labels (first and last)
  const formatDate = (d: Date) =>
    `${d.getMonth() + 1}/${d.getDate()}`;

  const currentBest = Math.max(...data.map((d) => d.est1rm));
  const latestEst = data[data.length - 1]?.est1rm || 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-gray-900">{LIFT_LABELS[lift]}</h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-600">
            Best: <span className="font-bold text-gray-900">{currentBest} {unit}</span>
          </span>
          <span className="text-gray-600">
            Latest: <span className="font-bold" style={{ color: colors.line }}>{latestEst} {unit}</span>
          </span>
        </div>
      </div>
      
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="w-full h-auto"
        style={{ maxHeight: "160px" }}
      >
        {/* Area fill */}
        <path d={areaPath} fill={colors.fill} opacity={0.5} />
        
        {/* Grid lines */}
        {yLabels.map((y) => (
          <line
            key={y}
            x1={paddingLeft}
            y1={yScale(y)}
            x2={chartWidth - paddingRight}
            y2={yScale(y)}
            stroke="#e5e7eb"
            strokeDasharray="2,2"
          />
        ))}

        {/* Y-axis labels */}
        {yLabels.map((y) => (
          <text
            key={y}
            x={paddingLeft - 5}
            y={yScale(y)}
            textAnchor="end"
            dominantBaseline="middle"
            className="text-[10px] fill-gray-500"
          >
            {y}
          </text>
        ))}

        {/* X-axis date labels */}
        <text
          x={paddingLeft}
          y={chartHeight - 5}
          textAnchor="start"
          className="text-[10px] fill-gray-500"
        >
          {formatDate(data[0].date)}
        </text>
        <text
          x={chartWidth - paddingRight}
          y={chartHeight - 5}
          textAnchor="end"
          className="text-[10px] fill-gray-500"
        >
          {formatDate(data[data.length - 1].date)}
        </text>

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke={colors.line}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {data.map((d, i) => (
          <g key={i}>
            {d.pr ? (
              <>
                {/* PR marker - star burst */}
                <circle
                  cx={xScale(i)}
                  cy={yScale(d.est1rm)}
                  r={8}
                  fill={colors.pr}
                  opacity={0.3}
                />
                <circle
                  cx={xScale(i)}
                  cy={yScale(d.est1rm)}
                  r={5}
                  fill={colors.pr}
                  stroke="#fff"
                  strokeWidth={2}
                />
                <text
                  x={xScale(i)}
                  y={yScale(d.est1rm) - 14}
                  textAnchor="middle"
                  className="text-[8px] font-bold fill-amber-600"
                >
                  PR! {d.est1rm}
                </text>
              </>
            ) : (
              <>
                <circle
                  cx={xScale(i)}
                  cy={yScale(d.est1rm)}
                  r={3}
                  fill={colors.line}
                  stroke="#fff"
                  strokeWidth={1.5}
                />
                <text
                  x={xScale(i)}
                  y={yScale(d.est1rm) - 8}
                  textAnchor="middle"
                  className="text-[8px] fill-gray-600"
                >
                  {d.est1rm}
                </text>
              </>
            )}
          </g>
        ))}
      </svg>
      
      {/* PR Legend */}
      {data.some((d) => d.pr) && (
        <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-amber-500"></span>
            Personal Record
          </span>
        </div>
      )}
    </div>
  );
}

type AllLiftsProps = {
  unit: "lb" | "kg";
};

export function AllLiftsProgressCharts({ unit }: AllLiftsProps) {
  const lifts: Lift[] = ["bench", "squat", "deadlift"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">📈 Lift Progress</h2>
        <span className="text-sm text-gray-500">Est. 1RM over time</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {lifts.map((lift) => (
          <LiftProgressChart key={lift} lift={lift} unit={unit} />
        ))}
      </div>
    </div>
  );
}
