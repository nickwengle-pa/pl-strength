import React, { useState } from "react";
import type { Unit } from "../lib/db";

type OnboardingStep = "welcome" | "tm-explanation" | "program-overview" | "app-tour" | "complete";

interface OnboardingWizardProps {
  onComplete: () => void;
  unit: Unit;
}

export default function OnboardingWizard({ onComplete, unit }: OnboardingWizardProps) {
  const [step, setStep] = useState<OnboardingStep>("welcome");

  const nextStep = () => {
    const steps: OnboardingStep[] = ["welcome", "tm-explanation", "program-overview", "app-tour", "complete"];
    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1]);
    } else {
      onComplete();
    }
  };

  const prevStep = () => {
    const steps: OnboardingStep[] = ["welcome", "tm-explanation", "program-overview", "app-tour", "complete"];
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
    }
  };

  const skipOnboarding = () => {
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-brand-500 to-brand-600 p-6 text-white">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">Welcome To PL Strength</h2>
            <button
              onClick={skipOnboarding}
              className="text-sm text-white/80 hover:text-white underline"
            >
              Skip Tutorial
            </button>
          </div>
          {/* Progress Bar */}
          <div className="mt-4 flex gap-2">
            {["welcome", "tm-explanation", "program-overview", "app-tour", "complete"].map((s, idx) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  ["welcome", "tm-explanation", "program-overview", "app-tour", "complete"].indexOf(step) >= idx
                    ? "bg-white"
                    : "bg-white/30"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === "welcome" && (
            <div className="space-y-4">
              <h3 className="text-2xl font-bold text-gray-900">Let's Get Started! 💪</h3>
              <p className="text-gray-700 text-lg">
                PL Strength Helps You Track Your Powerlifting Journey Using The Proven 5/3/1 Training Methodology.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-blue-900 font-medium">This Quick Tutorial Will Show You:</p>
                <ul className="mt-2 space-y-2 text-blue-800">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">✓</span>
                    <span>What A Training Max Is And Why It Matters</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">✓</span>
                    <span>How The 5/3/1 Program Works</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">✓</span>
                    <span>Key Features Of The App</span>
                  </li>
                </ul>
              </div>
              <p className="text-gray-600 text-sm">
                Takes About 2 Minutes. Ready?
              </p>
            </div>
          )}

          {step === "tm-explanation" && (
            <div className="space-y-4">
              <h3 className="text-2xl font-bold text-gray-900">Training Max (TM) 📊</h3>
              <p className="text-gray-700">
                Your <strong>Training Max</strong> Is The Foundation Of Your Training Program. It's Approximately <strong>90% Of Your True 1-Rep Max</strong>.
              </p>
              
              <div className="bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4">
                <p className="font-semibold text-purple-900 mb-2">Why Use 90% Instead Of 100%?</p>
                <p className="text-purple-800 text-sm">
                  Using 90% Allows You To:
                </p>
                <ul className="mt-2 space-y-1 text-purple-800 text-sm">
                  <li>• Maintain Proper Form Throughout Your Sets</li>
                  <li>• Avoid Burnout And Overtraining</li>
                  <li>• Hit AMRAP (As Many Reps As Possible) Sets With Confidence</li>
                  <li>• Progress Steadily Over Time</li>
                </ul>
              </div>

              <div className="bg-gray-100 rounded-lg p-4">
                <p className="font-semibold text-gray-900 mb-2">Example:</p>
                <p className="text-gray-700 text-sm">
                  If Your Max Bench Press Is 200 {unit}, Your Training Max Would Be Around <strong>180 {unit}</strong>.
                </p>
                <p className="text-gray-600 text-xs mt-2">
                  Think Of It As A Weight You Could Lift For A Solid 2-3 Reps On A Good Day.
                </p>
              </div>
            </div>
          )}

          {step === "program-overview" && (
            <div className="space-y-4">
              <h3 className="text-2xl font-bold text-gray-900">The 5/3/1 Program 📅</h3>
              <p className="text-gray-700">
                5/3/1 Is A Simple, Effective Strength Program Based On 3-Week Cycles With Progressive Overload.
              </p>

              <div className="space-y-3">
                <div className="border-l-4 border-green-500 bg-green-50 p-4 rounded-r-lg">
                  <p className="font-semibold text-green-900">Week 1: Build Volume (5+ Reps)</p>
                  <p className="text-green-800 text-sm mt-1">3 Work Sets: 65%, 75%, 85% × 5 Reps</p>
                </div>

                <div className="border-l-4 border-blue-500 bg-blue-50 p-4 rounded-r-lg">
                  <p className="font-semibold text-blue-900">Week 2: Increase Weight (3+ Reps)</p>
                  <p className="text-blue-800 text-sm mt-1">3 Work Sets: 70%, 80%, 90% × 3 Reps</p>
                </div>

                <div className="border-l-4 border-purple-500 bg-purple-50 p-4 rounded-r-lg">
                  <p className="font-semibold text-purple-900">Week 3: Go Heavy (5/3/1+ Reps)</p>
                  <p className="text-purple-800 text-sm mt-1">3 Work Sets: 75%, 85%, 95% × 5/3/1 Reps</p>
                </div>
</div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="font-semibold text-yellow-900">The Last Set Is AMRAP!</p>
                <p className="text-yellow-800 text-sm mt-1">
                  On Your Final Work Set Each Day, Do As Many Quality Reps As Possible. This Drives Progress And Tests Your Strength.
                </p>
              </div>
            </div>
          )}

          {step === "app-tour" && (
            <div className="space-y-4">
              <h3 className="text-2xl font-bold text-gray-900">Key App Features 🚀</h3>
              <p className="text-gray-700">
                Here's What You Can Do In PL Strength:
              </p>

              <div className="space-y-3">
                <div className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl">📝</div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">Summary Dashboard</p>
                    <p className="text-gray-600 text-sm">See Today's Workout And Track Your Progress</p>
                  </div>
                </div>

                <div className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl">💪</div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">Session Logging</p>
                    <p className="text-gray-600 text-sm">Log Your Workouts With Mobile-Friendly Interface And Rest Timer</p>
                  </div>
                </div>

                <div className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl">📊</div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">Progress Charts</p>
                    <p className="text-gray-600 text-sm">Visualize Your Strength Gains Over Time</p>
                  </div>
                </div>

                <div className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl">🧮</div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">Calculator & Sheets</p>
                    <p className="text-gray-600 text-sm">Calculate Your TM And Generate Workout Sheets</p>
                  </div>
                </div>

                <div className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl">📖</div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">Program Outline & Guide</p>
                    <p className="text-gray-600 text-sm">Reference The Full Program Details Anytime</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === "complete" && (
            <div className="space-y-4 text-center">
              <div className="text-6xl">🎉</div>
              <h3 className="text-2xl font-bold text-gray-900">You're All Set!</h3>
              <p className="text-gray-700 text-lg">
                You're Ready To Start Tracking Your Strength Journey.
              </p>
              
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="font-semibold text-green-900 mb-2">Next Steps:</p>
                <ol className="text-left space-y-2 text-green-800 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="font-bold">1.</span>
                    <span>Go To <strong>Calculator</strong> To Estimate Your Training Max</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold">2.</span>
                    <span>Set Your TM For Each Lift In <strong>Profile</strong></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold">3.</span>
                    <span>Check <strong>Summary</strong> To See Today's Workout</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold">4.</span>
                    <span>Hit The Gym And Log Your Sets In <strong>Session</strong>!</span>
                  </li>
                </ol>
              </div>

              <p className="text-gray-600 text-sm">
                Need Help Later? Check The <strong>Guide</strong> Page Anytime.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 p-6 flex items-center justify-between bg-gray-50 rounded-b-2xl">
          <button
            onClick={prevStep}
            disabled={step === "welcome"}
            className="px-4 py-2 text-gray-700 font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-200 rounded-lg transition-colors"
          >
            ← Back
          </button>
          
          <div className="text-sm text-gray-500">
            Step {["welcome", "tm-explanation", "program-overview", "app-tour", "complete"].indexOf(step) + 1} Of 5
          </div>

          <button
            onClick={nextStep}
            className="px-6 py-2 bg-brand-500 text-white font-semibold rounded-lg hover:bg-brand-600 transition-colors shadow-md"
          >
            {step === "complete" ? "Get Started!" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}
