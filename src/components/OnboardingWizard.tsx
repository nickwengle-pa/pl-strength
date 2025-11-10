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
            <h2 className="text-2xl font-bold">Welcome to PL Strength</h2>
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
                PL Strength helps you track your powerlifting journey using the proven 5/3/1 training methodology.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-blue-900 font-medium">This quick tutorial will show you:</p>
                <ul className="mt-2 space-y-2 text-blue-800">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">✓</span>
                    <span>What a Training Max is and why it matters</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">✓</span>
                    <span>How the 5/3/1 program works</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">✓</span>
                    <span>Key features of the app</span>
                  </li>
                </ul>
              </div>
              <p className="text-gray-600 text-sm">
                Takes about 2 minutes. Ready?
              </p>
            </div>
          )}

          {step === "tm-explanation" && (
            <div className="space-y-4">
              <h3 className="text-2xl font-bold text-gray-900">Training Max (TM) 📊</h3>
              <p className="text-gray-700">
                Your <strong>Training Max</strong> is the foundation of your training program. It's approximately <strong>90% of your true 1-rep max</strong>.
              </p>
              
              <div className="bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4">
                <p className="font-semibold text-purple-900 mb-2">Why use 90% instead of 100%?</p>
                <p className="text-purple-800 text-sm">
                  Using 90% allows you to:
                </p>
                <ul className="mt-2 space-y-1 text-purple-800 text-sm">
                  <li>• Maintain proper form throughout your sets</li>
                  <li>• Avoid burnout and overtraining</li>
                  <li>• Hit AMRAP (As Many Reps As Possible) sets with confidence</li>
                  <li>• Progress steadily over time</li>
                </ul>
              </div>

              <div className="bg-gray-100 rounded-lg p-4">
                <p className="font-semibold text-gray-900 mb-2">Example:</p>
                <p className="text-gray-700 text-sm">
                  If your max bench press is 200 {unit}, your Training Max would be around <strong>180 {unit}</strong>.
                </p>
                <p className="text-gray-600 text-xs mt-2">
                  Think of it as a weight you could lift for a solid 2-3 reps on a good day.
                </p>
              </div>
            </div>
          )}

          {step === "program-overview" && (
            <div className="space-y-4">
              <h3 className="text-2xl font-bold text-gray-900">The 5/3/1 Program 📅</h3>
              <p className="text-gray-700">
                5/3/1 is a simple, effective strength program based on 4-week cycles with progressive overload.
              </p>

              <div className="space-y-3">
                <div className="border-l-4 border-green-500 bg-green-50 p-4 rounded-r-lg">
                  <p className="font-semibold text-green-900">Week 1: Build Volume (5+ reps)</p>
                  <p className="text-green-800 text-sm mt-1">3 work sets: 65%, 75%, 85% × 5 reps</p>
                </div>

                <div className="border-l-4 border-blue-500 bg-blue-50 p-4 rounded-r-lg">
                  <p className="font-semibold text-blue-900">Week 2: Increase Weight (3+ reps)</p>
                  <p className="text-blue-800 text-sm mt-1">3 work sets: 70%, 80%, 90% × 3 reps</p>
                </div>

                <div className="border-l-4 border-purple-500 bg-purple-50 p-4 rounded-r-lg">
                  <p className="font-semibold text-purple-900">Week 3: Go Heavy (5/3/1+ reps)</p>
                  <p className="text-purple-800 text-sm mt-1">3 work sets: 75%, 85%, 95% × 5/3/1 reps</p>
                </div>

                <div className="border-l-4 border-orange-500 bg-orange-50 p-4 rounded-r-lg">
                  <p className="font-semibold text-orange-900">Week 4: Deload & Recover</p>
                  <p className="text-orange-800 text-sm mt-1">Light week at 40-60% for recovery</p>
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="font-semibold text-yellow-900">The Last Set is AMRAP!</p>
                <p className="text-yellow-800 text-sm mt-1">
                  On your final work set each day, do as many quality reps as possible. This drives progress and tests your strength.
                </p>
              </div>
            </div>
          )}

          {step === "app-tour" && (
            <div className="space-y-4">
              <h3 className="text-2xl font-bold text-gray-900">Key App Features 🚀</h3>
              <p className="text-gray-700">
                Here's what you can do in PL Strength:
              </p>

              <div className="space-y-3">
                <div className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl">📝</div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">Summary Dashboard</p>
                    <p className="text-gray-600 text-sm">See today's workout and track your progress</p>
                  </div>
                </div>

                <div className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl">💪</div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">Session Logging</p>
                    <p className="text-gray-600 text-sm">Log your workouts with mobile-friendly interface and rest timer</p>
                  </div>
                </div>

                <div className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl">📊</div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">Progress Charts</p>
                    <p className="text-gray-600 text-sm">Visualize your strength gains over time</p>
                  </div>
                </div>

                <div className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl">🧮</div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">Calculator & Sheets</p>
                    <p className="text-gray-600 text-sm">Calculate your TM and generate workout sheets</p>
                  </div>
                </div>

                <div className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="text-2xl">📖</div>
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">Program Outline & Guide</p>
                    <p className="text-gray-600 text-sm">Reference the full program details anytime</p>
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
                You're ready to start tracking your strength journey.
              </p>
              
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="font-semibold text-green-900 mb-2">Next Steps:</p>
                <ol className="text-left space-y-2 text-green-800 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="font-bold">1.</span>
                    <span>Go to <strong>Calculator</strong> to estimate your Training Max</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold">2.</span>
                    <span>Set your TM for each lift in <strong>Profile</strong></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold">3.</span>
                    <span>Check <strong>Summary</strong> to see today's workout</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold">4.</span>
                    <span>Hit the gym and log your sets in <strong>Session</strong>!</span>
                  </li>
                </ol>
              </div>

              <p className="text-gray-600 text-sm">
                Need help later? Check the <strong>Guide</strong> page anytime.
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
            Step {["welcome", "tm-explanation", "program-overview", "app-tour", "complete"].indexOf(step) + 1} of 5
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
