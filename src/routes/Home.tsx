import React from "react";
import { Link } from "react-router-dom";

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
    detail: "Your best lift so far. New PRs mean progress—celebrate them.",
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
    <div className="container py-8 space-y-8">
      <div>
        <h1>Let's Train</h1>
        <p className="mt-2 text-sm text-gray-600">
          Pick a tab to get moving. Every page is simple, fast, and ready for
          younger lifters.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Link to="/summary" className="card transition-shadow hover:shadow-md">
          <h3 className="mb-2">Quick Summary</h3>
          <p className="text-sm text-gray-600">
            Simple plan for today. Big buttons. No fluff.
          </p>
        </Link>
        <Link to="/calculator" className="card transition-shadow hover:shadow-md">
          <h3 className="mb-2">Calculator / Table</h3>
          <p className="text-sm text-gray-600">
            Auto-calc warm-ups and work sets with rounding.
          </p>
        </Link>
        <Link to="/sheets" className="card transition-shadow hover:shadow-md">
          <h3 className="mb-2">Printable / Fillable Sheets</h3>
          <p className="text-sm text-gray-600">
            Week 1-4 or blank sheets. Print or fill and save.
          </p>
        </Link>
        <Link to="/roster" className="card transition-shadow hover:shadow-md">
          <h3 className="mb-2">Roster</h3>
          <p className="text-sm text-gray-600">
            Coaches: names, teams, units. Clean and fast.
          </p>
        </Link>
      </div>

      <div className="card space-y-4">
        <h2 className="text-xl font-semibold">
          Cheat Sheet: What the letters mean
        </h2>
        <p className="text-sm text-gray-600">
          Lifting comes with a lot of shorthand. Use this to remember what you
          see in the app and on the sheets.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {ABBREVIATIONS.map((item) => (
            <div
              key={item.code}
              className="rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-sm"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-lg font-semibold text-brand-700">
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
  );
}
