import React, { useMemo } from "react";
import { type Unit, type EquipmentSettings } from "../lib/db";

export type PlatePlanRow = { weight: number; count: number };

export type PlatePlanResult = {
  perSide: PlatePlanRow[];
  difference: number;
  totalUsed: number;
  target: number;
  barWeight: number;
  isPossible: boolean;
};

export const formatNumber = (value: number, digits = 2): string => {
  const fixed = value.toFixed(digits);
  return Number(fixed).toString();
};

export const computePlatePlan = (
  target: number | "",
  barWeight: number,
  plates: number[]
): PlatePlanResult | null => {
  if (typeof target !== "number" || !Number.isFinite(target) || target <= 0) {
    return null;
  }
  const usableBarWeight = Number.isFinite(barWeight) && barWeight > 0 ? barWeight : 0;
  const sortedPlates = Array.from(
    new Set(
      plates
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  ).sort((a, b) => b - a);

  const perSide: PlatePlanRow[] = [];
  const plateTotal = target - usableBarWeight;

  if (plateTotal <= 0 || !sortedPlates.length) {
    const difference = Number((target - usableBarWeight).toFixed(3));
    return {
      perSide,
      difference,
      totalUsed: usableBarWeight,
      target,
      barWeight: usableBarWeight,
      isPossible: Math.abs(difference) < 0.1,
    };
  }

  let remainingPerSide = plateTotal / 2;
  sortedPlates.forEach((plate) => {
    const count = Math.floor((remainingPerSide + 1e-6) / plate);
    if (count > 0) {
      perSide.push({ weight: Number(plate.toFixed(3)), count });
      remainingPerSide -= count * plate;
    }
  });

  const totalPlatesWeight =
    perSide.reduce((sum, item) => sum + item.weight * item.count, 0) * 2;
  const totalUsed = usableBarWeight + totalPlatesWeight;
  const difference = Number((target - totalUsed).toFixed(3));
  const tolerance = Math.max(0.1, target * 0.002);

  return {
    perSide,
    difference,
    totalUsed,
    target,
    barWeight: usableBarWeight,
    isPossible: Math.abs(difference) <= tolerance,
  };
};

export const flattenPlatesForVisual = (rows: PlatePlanRow[]): number[] =>
  rows.flatMap((row) => Array.from({ length: row.count }, () => row.weight));

export const plateColor = (index: number): string => {
  const palette = [
    "#38bdf8",
    "#34d399",
    "#60a5fa",
    "#a855f7",
    "#f97316",
    "#fbbf24",
    "#14b8a6",
    "#f472b6",
  ];
  return palette[index % palette.length];
};

type PlateVisualProps = {
  unit: Unit;
  barWeight: number;
  plates: number[];
  targetWeight: number | "";
};

export function PlateVisual({ unit, barWeight, plates, targetWeight }: PlateVisualProps) {
  const hasTarget = typeof targetWeight === "number" && targetWeight > 0;
  const maxPlate = plates.length ? Math.max(...plates) : 0;
  const minHeight = 60;
  const maxHeight = 140;
  const minWidth = 14;
  const maxWidth = 28;

  const scaleHeight = (weight: number): number => {
    if (!maxPlate) return minHeight;
    const ratio = weight / maxPlate;
    return Math.round(minHeight + ratio * (maxHeight - minHeight));
  };

  const scaleWidth = (weight: number): number => {
    if (!maxPlate) return minWidth;
    const ratio = weight / maxPlate;
    return Math.round(minWidth + ratio * (maxWidth - minWidth));
  };

  const plateData = plates.map((weight, index) => ({
    weight,
    height: scaleHeight(weight),
    width: scaleWidth(weight),
    color: plateColor(index),
    key: `${weight}-${index}`,
  }));

  return (
    <div className="relative overflow-x-auto overflow-y-visible rounded-xl bg-gradient-to-b from-slate-800 to-slate-900 p-6 text-white shadow-2xl">
      {/* Center bar */}
      <div className="absolute left-4 right-4 top-1/2 h-3 -translate-y-1/2">
        <div className="h-full w-full rounded-full bg-gradient-to-b from-slate-500 to-slate-600 shadow-lg" style={{
          boxShadow: "0 2px 8px rgba(0,0,0,0.5), inset 0 1px 2px rgba(255,255,255,0.3)"
        }} />
      </div>
      
      <div className="relative flex items-center justify-center gap-2">
        {/* Left end cap */}
        <div className="flex-shrink-0">
          <div className="flex flex-col items-center gap-1.5">
            <div className="relative flex items-center">
              {/* Sleeve end */}
              <div className="h-16 w-2 rounded-l-lg bg-gradient-to-r from-slate-700 to-slate-600" style={{
                boxShadow: "inset 2px 0 4px rgba(0,0,0,0.3)"
              }} />
              {/* Bar label box */}
              <div className="h-20 w-24 flex flex-col items-center justify-center rounded-lg bg-gradient-to-br from-slate-200 to-slate-300 text-xs font-bold text-slate-900 shadow-lg border-2 border-slate-400" style={{
                boxShadow: "0 4px 6px rgba(0,0,0,0.3), inset 0 1px 2px rgba(255,255,255,0.5)"
              }}>
                <div className="text-[10px] text-slate-600 uppercase tracking-wide">Bar</div>
                <div className="text-sm">{barWeight > 0 ? `${formatNumber(barWeight)}` : "—"}</div>
                <div className="text-[10px] text-slate-600">{unit}</div>
              </div>
              {/* Collar */}
              <div className="h-16 w-3 bg-gradient-to-r from-slate-600 to-slate-500 border-l border-slate-700" style={{
                boxShadow: "inset -2px 0 4px rgba(0,0,0,0.4), 2px 0 6px rgba(0,0,0,0.3)"
              }} />
            </div>
          </div>
        </div>

        {/* Plates */}
        <div className="flex items-center justify-start">
          <div className="flex items-center gap-1.5">
            {plateData.length ? (
              plateData.map((plate) => (
                <div key={plate.key} className="relative flex items-center">
                  <div
                    className="rounded-lg border-2 border-slate-900 relative"
                    style={{
                      height: `${plate.height}px`,
                      width: `${plate.width}px`,
                      background: `linear-gradient(135deg, ${plate.color} 0%, ${plate.color}dd 100%)`,
                      boxShadow: `
                        inset 0 2px 4px rgba(255,255,255,0.3),
                        inset 0 -2px 6px rgba(0,0,0,0.4),
                        0 4px 8px rgba(0,0,0,0.5)
                      `,
                    }}
                  >
                    {/* Inner hole */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-900 border border-slate-700" style={{
                      width: `${Math.min(plate.width - 8, 16)}px`,
                      height: `${Math.min(plate.width - 8, 16)}px`,
                      boxShadow: "inset 0 2px 4px rgba(0,0,0,0.8)"
                    }} />
                  </div>
                  <span className="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 rounded bg-slate-800/60 px-1.5 py-0.5 text-[11px] font-bold text-gray-100">
                    {formatNumber(plate.weight)}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-400 italic pl-2">
                {hasTarget ? "Bar only" : "Enter target weight"}
              </div>
            )}
          </div>
        </div>

        {/* Right collar (visible when plates exist) */}
        {plateData.length > 0 && (
          <div className="flex-shrink-0">
            <div className="h-16 w-3 bg-gradient-to-l from-slate-600 to-slate-500 border-r border-slate-700 rounded-r" style={{
              boxShadow: "inset 2px 0 4px rgba(0,0,0,0.4), -2px 0 6px rgba(0,0,0,0.3)"
            }} />
          </div>
        )}
      </div>
    </div>
  );
}

type PlateCalculatorDisplayProps = {
  targetWeight: number;
  unit: Unit;
  equipment: EquipmentSettings;
};

export function PlateCalculatorDisplay({ targetWeight, unit, equipment }: PlateCalculatorDisplayProps) {
  const platesForUnit = useMemo(
    () => equipment.plates[unit] ?? [],
    [equipment, unit]
  );
  const barOptions = useMemo(
    () => equipment.bars[unit] ?? [],
    [equipment, unit]
  );
  const activeBarId =
    equipment.activeBarId[unit] ?? (barOptions[0]?.id ?? null);
  const activeBar =
    barOptions.find((bar) => bar.id === activeBarId) ?? barOptions[0] ?? null;
  const activeBarWeight = activeBar?.weight ?? 0;

  const platePlan = useMemo(
    () => computePlatePlan(targetWeight, activeBarWeight, platesForUnit),
    [targetWeight, activeBarWeight, platesForUnit]
  );

  const visualPlates = useMemo(
    () => (platePlan ? flattenPlatesForVisual(platePlan.perSide) : []),
    [platePlan]
  );

  const perSideTotal = platePlan
    ? platePlan.perSide.reduce((sum, row) => sum + row.weight * row.count, 0)
    : 0;
  const planDifference = platePlan?.difference ?? 0;
  const planSummary = platePlan
    ? platePlan.isPossible
      ? `Load ${formatNumber(perSideTotal)} ${unit} per side on the ${formatNumber(
          activeBarWeight
        )} ${unit} bar.`
      : `You are short ${formatNumber(Math.abs(planDifference))} ${unit} with the current plates.`
    : "Enter a target weight to calculate plates.";

  return (
    <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-900 p-4 text-white">
      <PlateVisual
        unit={unit}
        barWeight={activeBarWeight}
        plates={visualPlates}
        targetWeight={targetWeight}
      />

      {platePlan && platePlan.perSide.length > 0 && (
        <div className="grid gap-x-6 gap-y-1 text-xs text-gray-200 sm:grid-cols-2 sm:text-sm">
          {platePlan.perSide.map((row, idx) => (
            <React.Fragment key={`${row.weight}-${idx}`}>
              <div>
                {row.count} x {formatNumber(row.weight)} {unit}
              </div>
              <div className="text-right">
                {formatNumber(row.weight * row.count)} {unit}/side
              </div>
            </React.Fragment>
          ))}
        </div>
      )}

      <div
        className={`rounded-xl border px-3 py-2 text-xs sm:text-sm ${
          platePlan
            ? platePlan.isPossible
              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border-rose-300 bg-rose-50 text-rose-700"
            : "border-gray-700 bg-gray-800 text-gray-200"
        }`}
      >
        {planSummary}
        {platePlan && !platePlan.isPossible && (
          <div className="mt-1 text-xs">
            Add smaller plates or adjust the target weight.
          </div>
        )}
      </div>
    </div>
  );
}
