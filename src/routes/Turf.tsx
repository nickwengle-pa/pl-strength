import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  subscribeProgramOutline,
  type ProgramOutlineRecord,
} from "../lib/db";

// Default values if not set in Firestore
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

export default function Turf() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [warmup, setWarmup] = useState<string[]>(DEFAULT_WARMUP);
  const [plyometrics, setPlyometrics] = useState<string[]>(DEFAULT_PLYOMETRICS);
  const [plyoDays, setPlyoDays] = useState<string[]>(DEFAULT_PLYO_DAYS);
  const [hipMobility, setHipMobility] = useState(DEFAULT_HIP_MOBILITY);

  useEffect(() => {
    const unsubscribe = subscribeProgramOutline((record: ProgramOutlineRecord | null) => {
      if (record) {
        if (record.turfWarmup && record.turfWarmup.length > 0) {
          setWarmup(record.turfWarmup);
        }
        if (record.plyometrics && record.plyometrics.length > 0) {
          setPlyometrics(record.plyometrics);
        }
        if (record.plyoDays && record.plyoDays.length > 0) {
          setPlyoDays(record.plyoDays);
        }
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white pb-6">
      {/* Header - Compact */}
      <div className="sticky top-0 z-10 bg-green-600 text-white px-4 py-3 shadow-lg">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 -ml-1 rounded-full hover:bg-green-500 active:bg-green-700 transition-colors"
            aria-label="Go back"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-bold">🌱 Turf Warmup & Plyos</h1>
        </div>
      </div>

      <div className="px-3 py-4 space-y-3 max-w-lg mx-auto">
        {/* Warmup Section - Compact */}
        <section className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="bg-green-100 px-3 py-2 border-b border-green-200">
            <h2 className="text-sm font-bold text-green-800">🏃 Dynamic Warmup</h2>
          </div>
          <ul className="px-3 py-2 space-y-0.5">
            {warmup.map((item, index) => (
              <li key={index} className="flex items-center gap-2 py-0.5">
                <span className="w-5 h-5 rounded-full bg-green-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {index + 1}
                </span>
                <span className="text-sm text-gray-800">{item}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Plyometrics Section - Compact */}
        <section className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="bg-orange-100 px-3 py-2 border-b border-orange-200">
            <h2 className="text-sm font-bold text-orange-800">⚡ Plyometrics</h2>
          </div>
          <div className="px-3 py-2">
            <ul className="space-y-0.5">
              {plyometrics.map((item, index) => (
                <li key={index} className="flex items-center gap-2 py-0.5">
                  <span className="w-5 h-5 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {index + 1}
                  </span>
                  <span className="text-sm text-gray-800">{item}</span>
                </li>
              ))}
            </ul>
            
            {/* Plyo Days - Stacked */}
            <div className="bg-orange-50 rounded-lg px-2 py-1.5 mt-2">
              <div className="text-xs font-semibold text-orange-800 mb-1">📅 Daily Schedule</div>
              {plyoDays.map((day, index) => (
                <div key={index} className="text-xs text-orange-700 flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-orange-400" />
                  {day}
                </div>
              ))}
              </div>
            </div>
          </div>
        </section>

        {/* Hip Mobility Video - Compact */}
        <section className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="bg-purple-100 px-3 py-2 border-b border-purple-200">
            <h2 className="text-sm font-bold text-purple-800">🧘 Hip Mobility</h2>
          </div>
          <div className="p-3">
            <p className="text-xs text-gray-600 mb-2">{hipMobility.note}</p>
            {/* Responsive video embed */}
            <div className="relative w-full" style={{ paddingBottom: "177.78%" /* 9:16 aspect ratio for shorts */ }}>
              <iframe
                className="absolute inset-0 w-full h-full rounded-lg"
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
              className="mt-2 block text-center text-xs text-purple-600 hover:text-purple-800 underline"
            >
              Open in YouTube →
            </a>
          </div>
        </section>

        {/* Done Button - Compact */}
        <button
          onClick={() => navigate("/")}
          className="w-full py-3 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-bold rounded-xl shadow-md transition-all active:scale-[0.98]"
        >
          ✓ Done - Back to Lifts
        </button>
      </div>
    </div>
  );
}
