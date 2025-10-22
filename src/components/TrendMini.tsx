import React from 'react';

type Props = { values: number[]; unit: 'lb'|'kg' };

export default function TrendMini({ values, unit }: Props) {
  if (!values || values.length === 0) {
    return <div className="text-sm text-gray-500">No history yet.</div>;
    }
  const w = 300, h = 80, pad = 6;
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(1, max - min);
  const pts = values.map((v, i) => ({
    x: pad + (i*(w-2*pad))/Math.max(1, values.length-1),
    y: h - pad - ((v - min) * (h-2*pad))/span
  }));
  const path = pts.map((p, i)=> (i===0?`M ${p.x},${p.y}`:`L ${p.x},${p.y}`)).join(' ');
  const last = values[values.length-1];
  const first = values[0];
  const delta = Math.round((last - first)*10)/10;

  return (
    <div className="space-y-1">
      <svg width={w} height={h} className="rounded-md border">
        <path d={path} strokeWidth="2" fill="none" stroke="currentColor"/>
      </svg>
      <div className="text-xs text-gray-700">
        Trend: {delta>0?'+':''}{delta} {unit} across {values.length} sessions
      </div>
    </div>
  );
}
