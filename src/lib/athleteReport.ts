import {
  defaultReportSettings,
  fetchAthleteSessions,
  formatTeamLabel,
  loadAttendanceSheet,
  loadProfileRemote,
  loadReportSettings,
  type Profile,
  type ReportSettings,
  type SessionRecord,
  type Team,
} from "./db";
import {
  brandedFooterHtml,
  brandedHeaderHtml,
  escapeHtml,
  pageSizeCss,
  printHtmlInIframe,
  sharedReportStyles,
} from "./reportHtml";

const LIFT_KEYS = ["bench", "squat", "deadlift"] as const;
type LiftKey = (typeof LIFT_KEYS)[number];

const LIFT_COLORS: Record<LiftKey, string> = {
  bench: "#dc2626",
  squat: "#2563eb",
  deadlift: "#16a34a",
};

export type AthleteAttendance = {
  present: number;
  total: number;
  dates: { date: string; present: boolean }[];
};

export type AthleteReportInput = {
  profile: Profile;
  /** Sessions sorted descending by createdAt (newest first), as returned by fetchAthleteSessions. */
  sessions: SessionRecord[];
  attendance: AthleteAttendance | null;
  settings: ReportSettings;
};

const fmtDate = (ts?: number | null): string =>
  ts
    ? new Date(ts).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

export function buildAthleteReportHtml(input: AthleteReportInput): string {
  const { profile, sessions, attendance, settings } = input;

  const fullName =
    `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() || "Athlete";
  const teamLabel = profile.team ? formatTeamLabel(profile.team) : "";
  const generatedAt = new Date().toLocaleString();

  // Per-lift derived data
  const buckets: Record<LiftKey, SessionRecord[]> = {
    bench: [],
    squat: [],
    deadlift: [],
  };
  for (const session of sessions) {
    const lift = session.lift as LiftKey;
    if (LIFT_KEYS.includes(lift)) buckets[lift].push(session);
  }

  const liftSummaries = LIFT_KEYS.map((lift) => {
    const liftSessions = buckets[lift];
    const latest = liftSessions[0];
    let bestEst: { value: number; unit: SessionRecord["unit"] } | null = null;
    for (const entry of liftSessions) {
      if (typeof entry.est1rm === "number" && Number.isFinite(entry.est1rm)) {
        if (!bestEst || entry.est1rm > bestEst.value) {
          bestEst = { value: entry.est1rm, unit: entry.unit };
        }
      }
    }
    return {
      lift,
      label: lift.charAt(0).toUpperCase() + lift.slice(1),
      tm: profile.tm?.[lift],
      bestEst,
      latest,
      totalSessions: liftSessions.length,
    };
  });

  const startingPoints = (() => {
    const perLift = LIFT_KEYS.map((lift) => {
      const liftSessions = buckets[lift];
      const earliest = liftSessions.length
        ? liftSessions[liftSessions.length - 1]
        : null;
      return {
        lift,
        label: lift.charAt(0).toUpperCase() + lift.slice(1),
        earliest,
      };
    });
    let startedAt: number | null = null;
    for (const session of sessions) {
      const ts = session.createdAt ?? null;
      if (typeof ts === "number" && Number.isFinite(ts)) {
        if (startedAt === null || ts < startedAt) startedAt = ts;
      }
    }
    if (startedAt === null && typeof profile.createdAt === "number") {
      startedAt = profile.createdAt;
    }
    return { perLift, startedAt };
  })();

  // Identity
  const identityRows: Array<[string, string]> = [];
  if (teamLabel) identityRows.push(["Team", teamLabel]);
  if (profile.graduationYear)
    identityRows.push(["Grad Year", String(profile.graduationYear)]);
  if (profile.height) identityRows.push(["Height", String(profile.height)]);
  if (profile.weight) identityRows.push(["Weight", String(profile.weight)]);
  if (profile.unit) identityRows.push(["Unit", profile.unit.toUpperCase()]);
  const identityHtml = identityRows.length
    ? `<table class="kv"><tbody>${identityRows
        .map(
          ([k, v]) =>
            `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`
        )
        .join("")}</tbody></table>`
    : "";

  const startedDate = startingPoints.startedAt
    ? new Date(startingPoints.startedAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "Unknown";

  const startingRowsHtml = startingPoints.perLift
    .map((entry) => {
      const s = entry.earliest;
      if (!s) {
        return `<tr><td>${escapeHtml(entry.label)}</td><td>—</td><td>—</td><td>—</td></tr>`;
      }
      return `<tr>
        <td>${escapeHtml(entry.label)}</td>
        <td>${escapeHtml(String(s.tm ?? 0))} ${escapeHtml(s.unit ?? "")}</td>
        <td>${escapeHtml(String(s.amrap?.weight ?? 0))} ${escapeHtml(s.unit ?? "")} × ${escapeHtml(String(s.amrap?.reps ?? 0))}</td>
        <td>${escapeHtml(fmtDate(s.createdAt))}</td>
      </tr>`;
    })
    .join("");

  const currentRowsHtml = liftSummaries
    .map((summary) => {
      const tm = summary.tm ?? 0;
      const bestEst = summary.bestEst
        ? `${summary.bestEst.value.toFixed(1)} ${summary.bestEst.unit}`
        : "—";
      const lastDate = summary.latest?.createdAt
        ? fmtDate(summary.latest.createdAt)
        : "—";
      return `<tr>
        <td>${escapeHtml(summary.label)}</td>
        <td>${escapeHtml(String(tm))}</td>
        <td>${escapeHtml(bestEst)}</td>
        <td>${escapeHtml(String(summary.totalSessions))}</td>
        <td>${escapeHtml(lastDate)}</td>
      </tr>`;
    })
    .join("");

  // Attendance
  const attendancePct =
    attendance && attendance.total > 0
      ? Math.round((attendance.present / attendance.total) * 100)
      : null;
  const attendanceSummaryHtml = attendance
    ? `<p><strong>Sessions Attended:</strong> ${attendance.present} / ${attendance.total}${attendancePct !== null ? ` (${attendancePct}%)` : ""}</p>`
    : `<p><em>No attendance data.</em></p>`;

  // PRs
  const prSessions = sessions.filter((s) => s.pr);
  const prRowsHtml = prSessions
    .slice(0, 25)
    .map(
      (s) => `<tr>
        <td>${escapeHtml(fmtDate(s.createdAt))}</td>
        <td>${escapeHtml(s.lift ?? "")}</td>
        <td>${escapeHtml(String(s.amrap?.weight ?? 0))} ${escapeHtml(s.unit ?? "")} × ${escapeHtml(String(s.amrap?.reps ?? 0))}</td>
        <td>${escapeHtml(s.est1rm ? s.est1rm.toFixed(1) : "—")}</td>
      </tr>`
    )
    .join("");
  const prSectionHtml = prSessions.length
    ? `<h2>Personal Records</h2>
       <table>
         <thead><tr><th>Date</th><th>Lift</th><th>AMRAP</th><th>Est 1RM</th></tr></thead>
         <tbody>${prRowsHtml}</tbody>
       </table>`
    : "";

  // Inline (small) charts — Y axis is the estimated 1RM (calculated max)
  const renderLiftChart = (lift: LiftKey, label: string): string => {
    const sessionsAsc = sessions
      .filter((s) => s.lift === lift)
      .filter(
        (s) => typeof s.est1rm === "number" && Number.isFinite(s.est1rm) && (s.est1rm ?? 0) > 0
      )
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    if (sessionsAsc.length < 2) {
      return `<div class="lift-chart lift-chart--empty">
        <div class="lift-chart-title" style="color:${LIFT_COLORS[lift]};">${escapeHtml(label)}</div>
        <div class="lift-chart-empty">Need at least 2 sessions to plot.</div>
      </div>`;
    }
    const W = 220;
    const H = 110;
    const PAD_L = 28;
    const PAD_R = 8;
    const PAD_T = 12;
    const PAD_B = 18;
    const ys = sessionsAsc.map((s) => s.est1rm ?? 0);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const yRange = maxY - minY || 1;
    const maxIdx = sessionsAsc.length - 1;
    const px = (i: number) => PAD_L + (i / maxIdx) * (W - PAD_L - PAD_R);
    const py = (v: number) =>
      H - PAD_B - ((v - minY) / yRange) * (H - PAD_T - PAD_B);
    const path = sessionsAsc
      .map(
        (s, i) =>
          `${i === 0 ? "M" : "L"} ${px(i).toFixed(1)} ${py(s.est1rm ?? 0).toFixed(1)}`
      )
      .join(" ");
    const dots = sessionsAsc
      .map(
        (s, i) =>
          `<circle cx="${px(i).toFixed(1)}" cy="${py(s.est1rm ?? 0).toFixed(1)}" r="2" fill="${LIFT_COLORS[lift]}" />`
      )
      .join("");
    const unit = sessionsAsc[0]?.unit ?? "lb";
    return `<div class="lift-chart">
      <div class="lift-chart-title" style="color:${LIFT_COLORS[lift]};">${escapeHtml(label)}</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;">
        <line x1="${PAD_L}" y1="${H - PAD_B}" x2="${W - PAD_R}" y2="${H - PAD_B}" stroke="#9ca3af" stroke-width="0.5" />
        <line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${H - PAD_B}" stroke="#9ca3af" stroke-width="0.5" />
        <text x="${PAD_L - 3}" y="${PAD_T + 3}" font-size="7" text-anchor="end" fill="#6b7280">${maxY.toFixed(0)} ${escapeHtml(unit)}</text>
        <text x="${PAD_L - 3}" y="${H - PAD_B + 2}" font-size="7" text-anchor="end" fill="#6b7280">${minY.toFixed(0)}</text>
        <text x="${PAD_L}" y="${H - 4}" font-size="7" fill="#6b7280">1</text>
        <text x="${W - PAD_R}" y="${H - 4}" font-size="7" text-anchor="end" fill="#6b7280">${sessionsAsc.length}</text>
        <path d="${path}" fill="none" stroke="${LIFT_COLORS[lift]}" stroke-width="1.5" />
        ${dots}
      </svg>
    </div>`;
  };
  const chartsHtml = LIFT_KEYS.map((lift) =>
    renderLiftChart(lift, lift.charAt(0).toUpperCase() + lift.slice(1))
  ).join("");

  // Full-page detail charts — Y axis is estimated 1RM
  const renderFullPageChart = (lift: LiftKey, label: string): string => {
    const sessionsAsc = sessions
      .filter((s) => s.lift === lift)
      .filter(
        (s) => typeof s.est1rm === "number" && Number.isFinite(s.est1rm) && (s.est1rm ?? 0) > 0
      )
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    if (sessionsAsc.length < 2) return "";
    const color = LIFT_COLORS[lift];
    const unit = sessionsAsc[0]?.unit ?? "lb";
    const ys = sessionsAsc.map((s) => s.est1rm ?? 0);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const yPad = Math.max(5, Math.round((maxY - minY) * 0.15));
    const lo = Math.max(0, minY - yPad);
    const hi = maxY + yPad;
    const yRange = hi - lo || 1;

    const W = 1000;
    const H = 540;
    const PAD_L = 80;
    const PAD_R = 40;
    const PAD_T = 30;
    const PAD_B = 110;
    const maxIdx = sessionsAsc.length - 1;
    const px = (i: number) => PAD_L + (i / maxIdx) * (W - PAD_L - PAD_R);
    const py = (v: number) =>
      H - PAD_B - ((v - lo) / yRange) * (H - PAD_T - PAD_B);

    const yTicks = 5;
    const gridLines: string[] = [];
    const yLabels: string[] = [];
    for (let i = 0; i <= yTicks; i += 1) {
      const v = lo + (i / yTicks) * yRange;
      const y = py(v);
      gridLines.push(
        `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="0.6" />`
      );
      yLabels.push(
        `<text x="${PAD_L - 8}" y="${(y + 3).toFixed(1)}" font-size="11" text-anchor="end" fill="#374151">${Math.round(v)}</text>`
      );
    }

    const linePath = sessionsAsc
      .map(
        (s, i) =>
          `${i === 0 ? "M" : "L"} ${px(i).toFixed(1)} ${py(s.est1rm ?? 0).toFixed(1)}`
      )
      .join(" ");
    const areaPath = `${linePath} L ${px(maxIdx).toFixed(1)} ${(H - PAD_B).toFixed(1)} L ${PAD_L.toFixed(1)} ${(H - PAD_B).toFixed(1)} Z`;

    const dateLabelEvery = Math.max(1, Math.ceil(sessionsAsc.length / 10));
    const dataElements = sessionsAsc
      .map((s, i) => {
        const cx = px(i);
        const cy = py(s.est1rm ?? 0);
        const w = (s.est1rm ?? 0).toFixed(0);
        const isPr = !!s.pr;
        const showDate = i === 0 || i === maxIdx || i % dateLabelEvery === 0;
        const dateStr = s.createdAt
          ? new Date(s.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          : "";
        const yearStr = s.createdAt
          ? new Date(s.createdAt).toLocaleDateString("en-US", { year: "2-digit" })
          : "";
        const dot = isPr
          ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="6" fill="#fbbf24" stroke="${color}" stroke-width="2" />`
          : `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${color}" />`;
        const weightLabel = `<text x="${cx.toFixed(1)}" y="${(cy - 10).toFixed(1)}" font-size="10" font-weight="700" text-anchor="middle" fill="#111827">${w}${isPr ? " ★" : ""}</text>`;
        const dateLabel = showDate
          ? `<g transform="translate(${cx.toFixed(1)} ${(H - PAD_B + 14).toFixed(1)}) rotate(-45)">
               <text font-size="10" text-anchor="end" fill="#4b5563">${escapeHtml(dateStr)}</text>
               <text font-size="9" text-anchor="end" fill="#9ca3af" y="11">'${escapeHtml(yearStr)}</text>
             </g>`
          : "";
        return dot + weightLabel + dateLabel;
      })
      .join("");

    const startWeight = Math.round(ys[0]);
    const endWeight = Math.round(ys[ys.length - 1]);
    const bestWeight = Math.round(maxY);
    const delta = endWeight - startWeight;
    const deltaSign = delta > 0 ? "+" : "";
    const startDateStr = sessionsAsc[0]?.createdAt
      ? fmtDate(sessionsAsc[0].createdAt)
      : "";
    const endDateStr = sessionsAsc[maxIdx]?.createdAt
      ? fmtDate(sessionsAsc[maxIdx].createdAt)
      : "";

    return `<div class="full-chart-page">
      <div class="full-chart-title" style="border-color:${color};color:${color};">${escapeHtml(label)}</div>
      <div class="full-chart-meta">
        <div><span class="meta-key">Start</span><strong>${startWeight} ${escapeHtml(unit)}</strong><span class="meta-sub">${escapeHtml(startDateStr)}</span></div>
        <div><span class="meta-key">Current</span><strong>${endWeight} ${escapeHtml(unit)}</strong><span class="meta-sub">${escapeHtml(endDateStr)}</span></div>
        <div><span class="meta-key">Best</span><strong>${bestWeight} ${escapeHtml(unit)}</strong></div>
        <div><span class="meta-key">Change</span><strong style="color:${delta >= 0 ? "#16a34a" : "#dc2626"};">${deltaSign}${delta} ${escapeHtml(unit)}</strong></div>
        <div><span class="meta-key">Sessions</span><strong>${sessionsAsc.length}</strong></div>
      </div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="grad-${lift}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.32" />
            <stop offset="100%" stop-color="${color}" stop-opacity="0" />
          </linearGradient>
        </defs>
        ${gridLines.join("")}
        <line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${H - PAD_B}" stroke="#374151" stroke-width="1" />
        <line x1="${PAD_L}" y1="${H - PAD_B}" x2="${W - PAD_R}" y2="${H - PAD_B}" stroke="#374151" stroke-width="1" />
        <text x="20" y="${(H / 2).toFixed(1)}" font-size="11" fill="#6b7280" transform="rotate(-90 20 ${(H / 2).toFixed(1)})" text-anchor="middle">Weight (${escapeHtml(unit)})</text>
        ${yLabels.join("")}
        <path d="${areaPath}" fill="url(#grad-${lift})" />
        <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        ${dataElements}
      </svg>
      <div class="full-chart-legend">
        <span><span class="dot" style="background:${color};"></span>Estimated 1RM per session</span>
        <span><span class="dot" style="background:#fbbf24;border:2px solid ${color};"></span>Personal record (★)</span>
      </div>
    </div>`;
  };
  const fullChartsHtml = LIFT_KEYS.map((lift) =>
    renderFullPageChart(lift, lift.charAt(0).toUpperCase() + lift.slice(1))
  ).join("");

  // Session log
  const sessionRowsHtml = sessions
    .map((s) => {
      const cycleWeek =
        s.cycle != null && s.week != null ? `C${s.cycle} W${s.week}` : "";
      return `<tr>
        <td>${escapeHtml(fmtDate(s.createdAt))}</td>
        <td>${escapeHtml(s.lift ?? "")}</td>
        <td>${escapeHtml(cycleWeek)}</td>
        <td>${escapeHtml(String(s.amrap?.weight ?? 0))} ${escapeHtml(s.unit ?? "")} × ${escapeHtml(String(s.amrap?.reps ?? 0))}</td>
        <td>${escapeHtml(s.est1rm ? s.est1rm.toFixed(1) : "—")}</td>
        <td>${s.pr ? "★" : ""}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(fullName)} — Athlete Report</title>
    <style>
      @page { size: ${pageSizeCss(settings)}; margin: 0.2in 0.5in; }
      ${sharedReportStyles}
      body { margin: 0; }
      table.kv { width: auto; }
      table.kv th { background: #f8fafc; font-weight: 600; text-align: left; min-width: 90px; }
      .meta { display: flex; gap: 18px; flex-wrap: wrap; margin: 6px 0 14px 0; font-size: 12px; color: #4b5563; }
      .section { margin-bottom: 16px; }
      .charts { display: flex; gap: 8px; margin-top: 6px; }
      .lift-chart { flex: 1 1 0; border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 8px; background: #fafafa; }
      .lift-chart--empty { background: #f9fafb; }
      .lift-chart-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 2px; }
      .lift-chart-empty { font-size: 9px; color: #9ca3af; padding: 18px 0; text-align: center; }
      .full-chart-page { page-break-before: always; padding-top: 12px; }
      .full-chart-title { font-size: 30px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; padding-bottom: 6px; border-bottom: 5px solid; margin-bottom: 14px; }
      .full-chart-meta { display: flex; gap: 28px; margin-bottom: 20px; flex-wrap: wrap; }
      .full-chart-meta > div { display: flex; flex-direction: column; }
      .full-chart-meta .meta-key { font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; color: #6b7280; font-weight: 600; }
      .full-chart-meta strong { font-size: 22px; font-weight: 700; color: #111827; line-height: 1.1; margin-top: 2px; }
      .full-chart-meta .meta-sub { font-size: 10px; color: #9ca3af; margin-top: 2px; }
      .full-chart-legend { margin-top: 14px; display: flex; gap: 22px; font-size: 11px; color: #4b5563; }
      .full-chart-legend .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
    </style>
  </head>
  <body>
    ${brandedHeaderHtml(settings)}
    <h1>${escapeHtml(fullName)}</h1>
    <div class="meta">
      ${teamLabel ? `<span><strong>Team:</strong> ${escapeHtml(teamLabel)}</span>` : ""}
      <span><strong>Started:</strong> ${escapeHtml(startedDate)}</span>
      <span><strong>Generated:</strong> ${escapeHtml(generatedAt)}</span>
    </div>

    ${identityHtml ? `<div class="section">${identityHtml}</div>` : ""}

    <div class="section">
      <h2>Starting Point</h2>
      <table>
        <thead><tr><th>Lift</th><th>Starting TM</th><th>Starting AMRAP</th><th>First Logged</th></tr></thead>
        <tbody>${startingRowsHtml}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Now</h2>
      <table>
        <thead><tr><th>Lift</th><th>Current TM</th><th>Best Est 1RM</th><th>Total Sessions</th><th>Last Session</th></tr></thead>
        <tbody>${currentRowsHtml}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Progress (Estimated 1RM per session)</h2>
      <div class="charts">${chartsHtml}</div>
    </div>

    <div class="section">
      <h2>Attendance</h2>
      ${attendanceSummaryHtml}
    </div>

    ${prSectionHtml ? `<div class="section">${prSectionHtml}</div>` : ""}

    <div class="section">
      <h2>Session Log</h2>
      <table>
        <thead><tr><th>Date</th><th>Lift</th><th>Cycle/Week</th><th>AMRAP</th><th>Est 1RM</th><th>PR</th></tr></thead>
        <tbody>${sessionRowsHtml}</tbody>
      </table>
    </div>

    ${brandedFooterHtml(settings)}

    ${fullChartsHtml}
  </body>
</html>`;
}

export async function loadAthleteAttendance(
  team: Team,
  uid: string
): Promise<AthleteAttendance | null> {
  try {
    const sheet = await loadAttendanceSheet(team);
    const athlete = sheet.athletes.find((a) => a.uid === uid);
    if (!athlete) return null;
    const records = sheet.records[athlete.id] ?? {};
    const sortedDates = [...sheet.dates].sort((a, b) => b.localeCompare(a));
    const dateEntries = sortedDates.map((d) => ({
      date: d,
      present: records[d] === true,
    }));
    const present = dateEntries.filter((d) => d.present).length;
    return { present, total: sheet.dates.length, dates: dateEntries };
  } catch {
    return null;
  }
}

/**
 * Full pipeline: fetch profile + sessions + attendance + settings, build the
 * HTML, and trigger the print dialog. Used by surfaces that don't already
 * have the data loaded (e.g. ActiveAthleteBanner).
 */
export async function generateAthleteReport(args: {
  uid: string;
  team?: Team | null;
}): Promise<void> {
  const profile = await loadProfileRemote(args.uid);
  if (!profile) throw new Error("Athlete profile not found.");
  const team = (args.team || profile.team) as Team | undefined;
  const [sessions, attendance, settings] = await Promise.all([
    fetchAthleteSessions(args.uid, 500, team).catch(() => []),
    team ? loadAthleteAttendance(team, args.uid) : Promise.resolve(null),
    team
      ? loadReportSettings(team).catch(() => defaultReportSettings(team))
      : Promise.resolve(defaultReportSettings()),
  ]);
  const html = buildAthleteReportHtml({ profile, sessions, attendance, settings });
  await printHtmlInIframe(html);
}
