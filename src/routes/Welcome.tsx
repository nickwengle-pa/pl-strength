import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fb, loadCustomQuotes, logNfcTap } from "../lib/db";
import { useAuth } from "../lib/auth";

/**
 * Built-in motivational quotes for the NFC welcome screen.
 * Coaches can add their own via the Settings panel.
 */
const DEFAULT_QUOTES: Array<{ text: string; author: string }> = [
  { text: "The only bad workout is the one that didn't happen.", author: "Unknown" },
  { text: "Strength does not come from the physical capacity. It comes from an indomitable will.", author: "Mahatma Gandhi" },
  { text: "The iron never lies to you.", author: "Henry Rollins" },
  { text: "What hurts today makes you stronger tomorrow.", author: "Jay Cutler" },
  { text: "The last three or four reps is what makes the muscle grow.", author: "Arnold Schwarzenegger" },
  { text: "Success isn't always about greatness. It's about consistency.", author: "Dwayne Johnson" },
  { text: "The pain you feel today will be the strength you feel tomorrow.", author: "Unknown" },
  { text: "Don't count the days, make the days count.", author: "Muhammad Ali" },
  { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
  { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
  { text: "The body achieves what the mind believes.", author: "Napoleon Hill" },
  { text: "No pain, no gain. Shut up and train.", author: "Unknown" },
  { text: "Be stronger than your strongest excuse.", author: "Unknown" },
  { text: "The only person you are destined to become is the person you decide to be.", author: "Ralph Waldo Emerson" },
  { text: "Champions aren't made in the gym. Champions are made from something deep inside them.", author: "Muhammad Ali" },
];

/**
 * Pick a quote based on the current date (rotates daily).
 * If custom quotes exist, they're merged with defaults.
 */
function pickDailyQuote(quotes: Array<{ text: string; author: string }>): { text: string; author: string } {
  if (!quotes.length) return DEFAULT_QUOTES[0];
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24)
  );
  return quotes[dayOfYear % quotes.length];
}

export default function Welcome() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, initializing } = useAuth();
  const [customQuotes, setCustomQuotes] = useState<Array<{ text: string; author: string }>>([]);
  const [fadeIn, setFadeIn] = useState(false);

  const tagId = searchParams.get("tag") ?? undefined;

  // Load custom quotes from Firestore
  useEffect(() => {
    let active = true;
    loadCustomQuotes()
      .then((quotes) => {
        if (active) setCustomQuotes(quotes);
      })
      .catch(() => {
        // Fallback to defaults only
      });
    return () => {
      active = false;
    };
  }, []);

  // Log the NFC tap for analytics
  useEffect(() => {
    if (tagId) {
      logNfcTap(tagId).catch(() => {
        // Silent fail - analytics not critical
      });
    }
  }, [tagId]);

  // Trigger fade-in animation
  useEffect(() => {
    const timer = setTimeout(() => setFadeIn(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Merge default and custom quotes
  const allQuotes = useMemo(() => {
    return [...DEFAULT_QUOTES, ...customQuotes];
  }, [customQuotes]);

  const dailyQuote = useMemo(() => pickDailyQuote(allQuotes), [allQuotes]);

  const handleStartTraining = () => {
    navigate("/");
  };

  // Don't show anything while checking auth state
  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-black">
        <div className="animate-pulse text-white/50">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-black px-6 py-12 relative overflow-hidden">
      {/* Large Background Dragon */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <img
          src="/assets/dragon.png"
          alt=""
          className="w-[80vw] h-[80vw] max-w-[500px] max-h-[500px] object-contain opacity-20 mix-blend-lighten"
        />
      </div>

      <div
        className={`relative z-10 max-w-md w-full text-center space-y-10 transition-all duration-700 ${
          fadeIn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        }`}
      >
        {/* App Title */}
        <div className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">
            PL STRENGTH
          </h1>
          <p className="text-sm text-white/50 uppercase tracking-widest font-medium">
            Purchase Line Dragons
          </p>
        </div>

        {/* Quote */}
        <div className="space-y-4 px-2">
          <blockquote className="text-xl md:text-2xl font-medium text-white/90 leading-relaxed italic">
            "{dailyQuote.text}"
          </blockquote>
          <p className="text-sm text-white/50 font-medium">
            — {dailyQuote.author}
          </p>
        </div>

        {/* CTA Buttons */}
        <div className="space-y-4 pt-4">
          <button
            type="button"
            onClick={handleStartTraining}
            className="w-full rounded-2xl bg-gradient-to-r from-red-600 to-red-700 px-8 py-4 text-lg font-bold text-white uppercase tracking-wide shadow-lg shadow-red-900/30 transition-all hover:from-red-500 hover:to-red-600 hover:shadow-xl hover:shadow-red-900/40 hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-red-500/30"
          >
            {user ? "Continue Training" : "Start Training"}
          </button>
        </div>
      </div>
    </div>
  );
}