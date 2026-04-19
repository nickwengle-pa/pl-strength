import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { loadCustomQuotes, logNfcTap, getFeaturedQuote, type FeaturedQuote } from "../lib/db";
import { useAuth } from "../lib/auth";

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

function pickDailyQuote(quotes: Array<{ text: string; author: string }>): { text: string; author: string } {
  if (!quotes.length) return DEFAULT_QUOTES[0];
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24)
  );
  return quotes[dayOfYear % quotes.length];
}

export default function WelcomeV2() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, initializing } = useAuth();
  const [customQuotes, setCustomQuotes] = useState<Array<{ text: string; author: string }>>([]);
  const [featuredQuote, setFeaturedQuote] = useState<FeaturedQuote | null>(null);
  const [fadeIn, setFadeIn] = useState(false);

  const tagId = searchParams.get("tag") ?? undefined;

  useEffect(() => {
    let active = true;
    Promise.all([loadCustomQuotes(), getFeaturedQuote()])
      .then(([quotes, featured]) => {
        if (active) {
          setCustomQuotes(quotes);
          setFeaturedQuote(featured);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (tagId) {
      logNfcTap(tagId).catch(() => {});
    }
  }, [tagId]);

  useEffect(() => {
    const timer = setTimeout(() => setFadeIn(true), 80);
    return () => clearTimeout(timer);
  }, []);

  const allQuotes = useMemo(() => [...DEFAULT_QUOTES, ...customQuotes], [customQuotes]);

  const displayQuote = useMemo(() => {
    if (featuredQuote) return { text: featuredQuote.text, author: featuredQuote.author };
    return pickDailyQuote(allQuotes);
  }, [featuredQuote, allQuotes]);

  const handleStartTraining = () => navigate("/");

  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-v2-surface-950">
        <span className="font-v2-heading text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em] animate-pulse">
          Loading…
        </span>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-v2-surface-950 relative overflow-hidden">
      {/* Atmospheric warm glow — subtle, not distracting */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 90% 55% at 50% 38%, rgba(122,15,24,0.22) 0%, transparent 68%)",
        }}
      />

      {/* Dragon watermark — hero mark, not just decoration */}
      <div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center pointer-events-none select-none"
        style={{ top: "-6%" }}
      >
        <img
          src="/assets/dragon.png"
          alt=""
          className="w-[78vw] max-w-[360px] opacity-[0.11]"
          style={{ filter: "grayscale(30%)" }}
        />
      </div>

      {/* Content */}
      <div
        className={`relative z-10 flex flex-col flex-1 px-gutter-mobile transition-all duration-700 ease-v2-entrance ${
          fadeIn ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
        }`}
      >
        {/* Upper content — centered vertically in the remaining space */}
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-8 pt-14">
          {/* Brand identity */}
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-3">
              <div className="h-px w-7 bg-v2-accent-700" />
              <span className="font-v2-body text-v2-xs text-v2-accent-300 uppercase tracking-[0.24em] font-semibold">
                Purchase Line Dragons
              </span>
              <div className="h-px w-7 bg-v2-accent-700" />
            </div>
            <h1 className="font-v2-heading text-v2-3xl font-bold text-v2-ink-50 uppercase tracking-tight leading-none">
              PL Strength
            </h1>
          </div>

          {/* Quote — editorial left-border treatment */}
          <blockquote className="max-w-[296px] text-left pl-4 border-l-2 border-v2-accent-700 space-y-2">
            <p className="font-v2-heading text-v2-xl font-semibold text-v2-ink-200 leading-snug">
              {displayQuote.text}
            </p>
            <footer className="font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-[0.14em]">
              &mdash;&nbsp;{displayQuote.author}
            </footer>
          </blockquote>
        </div>

        {/* CTA — pinned to bottom, respects safe-area on iOS PWA */}
        <div
          className="pb-8"
          style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom, 2rem))" }}
        >
          <button
            type="button"
            onClick={handleStartTraining}
            className="btn-v2-primary w-full min-h-touch-lg font-v2-heading text-v2-lg uppercase tracking-widest"
          >
            {user ? "Continue Training" : "Start Training"}
          </button>
        </div>
      </div>
    </div>
  );
}
