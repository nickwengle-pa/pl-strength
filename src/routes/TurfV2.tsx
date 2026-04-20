import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  subscribeProgramOutline,
  type ProgramOutlineRecord,
} from "../lib/db";

const DEFAULT_WARMUP = [
  "Jog in place 3-4 minutes",
  "Jumping jacks 1 minute",
  "Kickbacks",
  "Walking knee tucks",
  "Frankensteins",
  "Alternating side squats",
  "Inchworms",
  "Hip flexor (static)",
];

const DEFAULT_PLYOMETRICS = [
  "2 foot pogo jumps",
  "1 foot pogo jumps",
  "Ski jumps (land with little time on ground as possible)",
  "Jumps (no more than 20 per session)",
];

const DEFAULT_PLYO_DAYS = [
  "Monday - Broad jumps",
  "Tuesday - Box jumps",
  "Thursday - 1/2 broad 1/2 box",
];

const DEFAULT_HIP_MOBILITY = {
  note: "Follow along with the video for 3 sets of 8 per movement.",
  url: "https://youtube.com/shorts/O3Dudt2-OQ4?si=B5WIiAZfI0OaBBQF",
  embed: "https://www.youtube.com/embed/O3Dudt2-OQ4",
};

export default function TurfV2() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [warmup, setWarmup] = useState<string[]>(DEFAULT_WARMUP);
  const [plyometrics, setPlyometrics] = useState<string[]>(DEFAULT_PLYOMETRICS);
  const [plyoDays, setPlyoDays] = useState<string[]>(DEFAULT_PLYO_DAYS);
  const [hipMobility, setHipMobility] = useState(DEFAULT_HIP_MOBILITY);

  useEffect(() => {
    const unsubscribe = subscribeProgramOutline((record: ProgramOutlineRecord | null) => {
      if (record) {
        if (record.turfWarmup && record.turfWarmup.length > 0) setWarmup(record.turfWarmup);
        if (record.plyometrics && record.plyometrics.length > 0) setPlyometrics(record.plyometrics);
        if (record.plyoDays && record.plyoDays.length > 0) setPlyoDays(record.plyoDays);
        if (record.hipMobility) {
          setHipMobility({
            note: record.hipMobility.note || DEFAULT_HIP_MOBILITY.note,
            url: record.hipMobility.url || DEFAULT_HIP_MOBILITY.url,
            embed: record.hipMobility.embed || DEFAULT_HIP_MOBILITY.embed,
          });
        }
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-v2-surface-950">
        <span className="font-v2-heading text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em] animate-pulse">
          Loading…
        </span>
      </div>
    );
  }

  const SectionCard: React.FC<{
    label: string;
    accentClass: string;
    children: React.ReactNode;
  }> = ({ label, accentClass, children }) => (
    <section className="bg-v2-surface-900 border border-v2-surface-800 rounded-v2-md overflow-hidden shadow-v2-elev-1">
      <div className="px-4 py-3 border-b border-v2-surface-800 flex items-center gap-2">
        <div className={`h-px w-5 ${accentClass}`} />
        <span className="font-v2-body text-v2-xs font-semibold text-v2-ink-300 uppercase tracking-[0.22em]">
          {label}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );

  return (
    <div className="min-h-screen bg-v2-surface-950 text-v2-ink-50 pb-8 relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-64 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% 0%, rgba(16,185,129,0.10) 0%, transparent 70%)",
        }}
      />

      {/* Header */}
      <div className="relative z-10 bg-v2-surface-900/60 backdrop-blur-sm border-b border-v2-surface-800 px-4 py-4">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center justify-center w-11 h-11 rounded-v2-md border border-v2-surface-700 text-v2-ink-300 hover:border-v2-success-500 hover:text-v2-success-300 transition-colors duration-v2-quick"
            aria-label="Go back"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <div className="h-px w-6 bg-v2-success-600" />
              <span className="font-v2-body text-v2-xs text-v2-success-300 uppercase tracking-[0.24em] font-semibold">
                Prep
              </span>
            </div>
            <h1 className="font-v2-heading text-v2-2xl font-bold uppercase tracking-tight leading-none mt-1">
              Turf Warmup & Plyos
            </h1>
          </div>
        </div>
      </div>

      <div className="relative z-10 px-4 py-5 space-y-4 max-w-lg mx-auto">
        <SectionCard label="Dynamic Warmup" accentClass="bg-v2-success-600">
          <ul className="space-y-1.5">
            {warmup.map((item, index) => (
              <li key={index} className="flex items-center gap-3 py-1">
                <span className="flex-shrink-0 w-6 h-6 rounded-v2-full bg-v2-success-700 text-v2-ink-50 font-v2-mono text-v2-xs font-bold flex items-center justify-center tabular-nums">
                  {index + 1}
                </span>
                <span className="font-v2-body text-v2-sm text-v2-ink-100">{item}</span>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard label="Plyometrics" accentClass="bg-v2-warn-500">
          <ul className="space-y-1.5">
            {plyometrics.map((item, index) => (
              <li key={index} className="flex items-center gap-3 py-1">
                <span className="flex-shrink-0 w-6 h-6 rounded-v2-full bg-v2-warn-600 text-v2-ink-50 font-v2-mono text-v2-xs font-bold flex items-center justify-center tabular-nums">
                  {index + 1}
                </span>
                <span className="font-v2-body text-v2-sm text-v2-ink-100">{item}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950 px-3 py-2">
            <div className="font-v2-body text-v2-xs font-semibold text-v2-warn-300 uppercase tracking-[0.2em] mb-1.5">
              Daily Schedule
            </div>
            <div className="space-y-1">
              {plyoDays.map((day, index) => (
                <div key={index} className="font-v2-body text-v2-xs text-v2-ink-300 flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-v2-warn-500" />
                  {day}
                </div>
              ))}
            </div>
          </div>
        </SectionCard>

        <SectionCard label="Hip Mobility" accentClass="bg-v2-info-500">
          <p className="font-v2-body text-v2-xs text-v2-ink-400 mb-3">{hipMobility.note}</p>
          <div className="relative w-full rounded-v2-sm overflow-hidden bg-v2-surface-950" style={{ paddingBottom: "177.78%" }}>
            <iframe
              className="absolute inset-0 w-full h-full"
              src={hipMobility.embed}
              title="Hip Mobility Video"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          <a
            href={hipMobility.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 block text-center font-v2-body text-v2-xs text-v2-info-300 hover:text-v2-info-200 uppercase tracking-[0.18em] font-semibold underline underline-offset-4 decoration-v2-info-700 hover:decoration-v2-info-500 transition-colors duration-v2-quick"
          >
            Open in YouTube
          </a>
        </SectionCard>

        <button
          onClick={() => navigate("/")}
          className="w-full min-h-touch-lg py-4 bg-v2-accent-700 hover:bg-v2-accent-800 active:bg-v2-accent-900 text-v2-ink-50 font-v2-heading text-v2-lg font-bold uppercase tracking-widest transition-all duration-v2-quick rounded-v2-sm"
        >
          Done — Back to Lifts
        </button>
      </div>
    </div>
  );
}
