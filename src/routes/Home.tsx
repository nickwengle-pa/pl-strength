import React from "react";
import { Link } from "react-router-dom";

const FEATURE_LINKS = [
  {
    to: "/summary",
    label: "Quick Summary",
    message: "Simple plan for today. Big buttons. No fluff.",
    badge: "QS",
    accent: "from-amber-400/90 to-orange-500/90",
  },
  {
    to: "/calculator",
    label: "Calculator / Table",
    message: "Auto-calc warm-ups and work sets with rounding.",
    badge: "CT",
    accent: "from-sky-400/90 to-sky-600/90",
  },
  {
    to: "/sheets",
    label: "Printable / Fillable Sheets",
    message: "Week 1-4 or blank sheets. Print or fill and save.",
    badge: "SH",
    accent: "from-emerald-400/90 to-emerald-600/90",
  },
  {
    to: "/roster",
    label: "Roster",
    message: "Coaches: names, teams, units. Clean and fast.",
    badge: "RS",
    accent: "from-fuchsia-400/90 to-fuchsia-600/90",
  },
];

const ABBREVIATIONS = [
  {
    code: "TM",
    title: "Training Max",
    detail:
      "Weight you could lift for around 2-3 hard reps. Every plan and sheet uses this number.",
  },
  {
    code: "1RM",
    title: "One-Rep Max",
    detail: "The heaviest weight you can lift once with solid form.",
  },
  {
    code: "AMRAP",
    title: "As Many Reps As Possible",
    detail: "Push the set, but stop while you still have 1-2 good reps left.",
  },
  {
    code: "PR",
    title: "Personal Record",
    detail: "Your best lift so far. New PRs mean progress - celebrate them.",
  },
  {
    code: "RPE",
    title: "Rate of Perceived Exertion",
    detail: "How tough a set feels from 1-10. RPE 8 means about two reps left.",
  },
  {
    code: "% Bar",
    title: "Percent of TM",
    detail:
      "Sheets show weights as a percent of your TM so you know what plates to load.",
  },
];

export default function Home() {
  return (
    <div className="pb-12">
      <section className="relative isolate overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 text-white shadow-lg">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.16),transparent_55%)]" />
        <div className="absolute -right-24 top-1/2 hidden h-72 w-72 -translate-y-1/2 rounded-full bg-white/10 blur-3xl lg:block" />
        <div className="container relative px-4 py-10">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="space-y-4">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.35em] text-white/80">
                Let's Train
              </span>
              <h1 className="text-3xl font-semibold md:text-4xl">
                Your launchpad for every lift
              </h1>
              <p className="max-w-2xl text-sm text-white/80 md:text-base">
                Pick a tab to get moving. Each tool is quick, clear, and built
                for teams working with younger lifters.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 text-sm text-white/80 md:items-end">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 font-semibold uppercase tracking-wide text-white">
                Ready when you are
              </span>
              <span className="text-base text-white/80">
                Calculator, sheets, roster, and a quick plan - all within two taps.
              </span>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURE_LINKS.map((item) => (
              <div
                key={item.label}
                className="rounded-2xl bg-white/12 px-4 py-3 shadow-sm backdrop-blur-sm transition hover:bg-white/16"
              >
                <div className="text-[11px] uppercase tracking-wide text-white/70">
                  {item.badge} - {item.label}
                </div>
                <div className="mt-1 text-lg font-semibold text-white">
                  {item.message}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="container -mt-12 space-y-10">
        <div className="grid gap-6 lg:grid-cols-2">
          {FEATURE_LINKS.map((feature) => (
            <Link
              key={feature.label}
              to={feature.to}
              className="group relative overflow-hidden rounded-3xl border border-gray-100 bg-white p-6 shadow-lg transition hover:-translate-y-1 hover:shadow-xl"
            >
              <div
                className={`absolute -right-16 top-1/2 h-40 w-40 -translate-y-1/2 rounded-full blur-3xl opacity-60 transition-opacity duration-200 group-hover:opacity-90 ${feature.accent}`}
                aria-hidden="true"
              />
              <div className="relative z-10 space-y-3">
                <span className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-600">
                  {feature.badge}
                </span>
                <h3 className="text-2xl font-semibold text-gray-900">
                  {feature.label}
                </h3>
                <p className="text-sm text-gray-600">{feature.message}</p>
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700">
                  Open {feature.label}
                  <span aria-hidden="true">-&gt;</span>
                </span>
              </div>
            </Link>
          ))}
        </div>

        <div className="rounded-3xl border border-gray-100 bg-white/95 p-8 shadow-xl ring-1 ring-gray-100/80">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Cheat Sheet: What the letters mean
              </h2>
              <p className="text-sm text-gray-600">
                Lifting language can be a lot. Use this to decode the shorthand you
                see everywhere in PL Strength.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
              Quick Reference
            </span>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {ABBREVIATIONS.map((item) => (
              <div
                key={item.code}
                className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 shadow-inner transition hover:border-brand-200 hover:bg-brand-50/60"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xl font-semibold text-brand-700">
                    {item.code}
                  </span>
                  <span className="text-sm font-medium text-gray-700">
                    {item.title}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-600">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}