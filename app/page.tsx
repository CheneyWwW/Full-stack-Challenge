"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type StepKey = "GENDER" | "GOALS" | "BODY" | "ACTIVITY";

type Progress = {
  sessionId: string;
  nextStep: StepKey | null;
  completedSteps: StepKey[];
  version: number;
  draft: Partial<FormState>;
};

type ResultResponse = {
  access: "LOCKED" | "FULL";
  requiresPayment: boolean;
  subscriptionStatus: string;
  result: {
    bmi: number;
    bmiCategory: string;
    dailyCalories?: number;
    targetDate?: string;
    weeksToTarget?: number;
    predictionCurve?: Array<{ week: number; date: string; weightKg: number }>;
  };
  paywall?: { message: string; unlocks: string[] };
};

type FormState = {
  gender: "female" | "male" | "non_binary" | "prefer_not_to_say";
  primaryGoal: "lose_weight" | "maintain_health" | "build_strength" | "improve_mobility";
  focusAreas: Array<"belly" | "legs" | "arms" | "back" | "stress" | "posture">;
  age: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  activityFrequency: "sedentary" | "light" | "moderate" | "active";
};

const steps: Array<{ key: StepKey; label: string; title: string; copy: string }> = [
  {
    key: "GENDER",
    label: "Profile",
    title: "Let's personalize your plan",
    copy: "A few basics help us make the recommendation feel less generic."
  },
  {
    key: "GOALS",
    label: "Goals",
    title: "What would feel like progress?",
    copy: "Pick the outcome you care about most and the areas you want to focus on."
  },
  {
    key: "BODY",
    label: "Body data",
    title: "Set a realistic target",
    copy: "We use this only to calculate BMI, calorie guidance, and a safe timeline."
  },
  {
    key: "ACTIVITY",
    label: "Activity",
    title: "Match the plan to your pace",
    copy: "Your current routine changes the calorie estimate and weekly target."
  }
];

const defaultForm: FormState = {
  gender: "female",
  primaryGoal: "lose_weight",
  focusAreas: ["belly"],
  age: 35,
  heightCm: 165,
  weightKg: 73,
  targetWeightKg: 64,
  activityFrequency: "light"
};

function payloadForStep(step: StepKey, form: FormState) {
  if (step === "GENDER") return { gender: form.gender };
  if (step === "GOALS") return { primaryGoal: form.primaryGoal, focusAreas: form.focusAreas };
  if (step === "BODY") {
    return {
      age: Number(form.age),
      heightCm: Number(form.heightCm),
      weightKg: Number(form.weightKg),
      targetWeightKg: Number(form.targetWeightKg)
    };
  }
  return { activityFrequency: form.activityFrequency };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "Request failed");
  }
  return data as T;
}

export default function Home() {
  const [form, setForm] = useState<FormState>(defaultForm);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [result, setResult] = useState<ResultResponse | null>(null);
  const [status, setStatus] = useState("Preparing your assessment...");
  const [busy, setBusy] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const activeStep = steps[activeIndex];
  const percent = Math.round(((activeIndex + 1) / steps.length) * 100);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const stored = window.localStorage.getItem("health-session-id");
        const loaded = stored
          ? await api<Progress>(`/api/v1/sessions/${stored}/progress`).catch(() => null)
          : null;
        const nextProgress = loaded ?? (await api<Progress>("/api/v1/sessions", { method: "POST" }));
        if (cancelled) return;
        window.localStorage.setItem("health-session-id", nextProgress.sessionId);
        setProgress(nextProgress);
        setForm((current) => ({ ...current, ...nextProgress.draft }));
        const nextIndex = nextProgress.nextStep
          ? steps.findIndex((step) => step.key === nextProgress.nextStep)
          : steps.length - 1;
        setActiveIndex(Math.max(0, nextIndex));
        setStatus(loaded ? "Progress restored." : "Session created.");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to start assessment.");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const canSubmit = useMemo(() => {
    if (activeStep.key === "GOALS") return form.focusAreas.length > 0;
    if (activeStep.key === "BODY") {
      return form.age >= 13 && form.heightCm >= 120 && form.weightKg >= 35 && form.targetWeightKg >= 35;
    }
    return true;
  }, [activeStep.key, form]);

  async function saveCurrentStep(event: FormEvent) {
    event.preventDefault();
    if (!progress || !canSubmit) return;
    setBusy(true);
    try {
      const saved = await api<Progress>(
        `/api/v1/sessions/${progress.sessionId}/assessment-steps/${activeStep.key.toLowerCase()}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            version: progress.version,
            data: payloadForStep(activeStep.key, form)
          })
        }
      );
      setProgress(saved);
      setStatus("Saved.");
      if (activeIndex < steps.length - 1) {
        setActiveIndex((index) => index + 1);
      } else {
        const submitted = await api<{ result: ResultResponse["result"] }>(
          `/api/v1/sessions/${progress.sessionId}/assessment/submit`,
          { method: "POST" }
        );
        setStatus("Assessment complete.");
        setResult(
          await api<ResultResponse>(`/api/v1/sessions/${progress.sessionId}/results`)
        );
        if (!submitted.result) setStatus("Assessment complete.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }

  async function completeMockPayment() {
    if (!progress) return;
    setBusy(true);
    try {
        await api("/pay", {
          method: "POST",
          body: JSON.stringify({
            sessionId: progress.sessionId,
            idempotencyKey: `demo_${progress.sessionId}`
          })
        });
      setResult(await api<ResultResponse>(`/api/v1/sessions/${progress.sessionId}/results`));
      setCheckoutOpen(false);
      setStatus("Payment callback applied. Full plan unlocked.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to unlock.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <section className="panel">
        <div className="brandbar">
          <span className="mark">HW</span>
          <span>Home Wellness</span>
        </div>
        <div className="progressbar" aria-label="Assessment progress">
          <span style={{ width: `${percent}%` }} />
        </div>
        <p className="kicker">{activeStep.label}</p>
        {!result ? (
          <form onSubmit={saveCurrentStep} className="flow">
            <h1>{activeStep.title}</h1>
            <p className="support">{activeStep.copy}</p>

            {activeStep.key === "GENDER" && (
              <div className="choice-grid">
                {[
                  ["female", "Female"],
                  ["male", "Male"],
                  ["non_binary", "Non-binary"],
                  ["prefer_not_to_say", "Prefer not to say"]
                ].map(([value, label]) => (
                  <label className="choice" key={value}>
                    <input
                      type="radio"
                      name="gender"
                      checked={form.gender === value}
                      onChange={() => setForm({ ...form, gender: value as FormState["gender"] })}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            )}

            {activeStep.key === "GOALS" && (
              <>
                <select
                  value={form.primaryGoal}
                  onChange={(event) =>
                    setForm({ ...form, primaryGoal: event.target.value as FormState["primaryGoal"] })
                  }
                >
                  <option value="lose_weight">Lose weight</option>
                  <option value="maintain_health">Maintain health</option>
                  <option value="build_strength">Build strength</option>
                  <option value="improve_mobility">Improve mobility</option>
                </select>
                <div className="choice-grid">
                  {[
                    ["belly", "Belly"],
                    ["legs", "Legs"],
                    ["arms", "Arms"],
                    ["back", "Back"],
                    ["stress", "Stress"],
                    ["posture", "Posture"]
                  ].map(([value, label]) => {
                    const checked = form.focusAreas.includes(value as never);
                    return (
                      <label className="choice" key={value}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const focusAreas = checked
                              ? form.focusAreas.filter((area) => area !== value)
                              : [...form.focusAreas, value as never];
                            setForm({ ...form, focusAreas });
                          }}
                        />
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            {activeStep.key === "BODY" && (
              <div className="metric-grid">
                {[
                  ["Age", "age", 13, 90],
                  ["Height, cm", "heightCm", 120, 230],
                  ["Current weight, kg", "weightKg", 35, 300],
                  ["Goal weight, kg", "targetWeightKg", 35, 300]
                ].map(([label, key, min, max]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min={min}
                      max={max}
                      value={form[key as keyof FormState] as number}
                      onChange={(event) =>
                        setForm({ ...form, [key as string]: Number(event.target.value) })
                      }
                    />
                  </label>
                ))}
              </div>
            )}

            {activeStep.key === "ACTIVITY" && (
              <div className="choice-grid">
                {[
                  ["sedentary", "Mostly sitting"],
                  ["light", "Light routine"],
                  ["moderate", "Several workouts weekly"],
                  ["active", "Very active"]
                ].map(([value, label]) => (
                  <label className="choice" key={value}>
                    <input
                      type="radio"
                      name="activity"
                      checked={form.activityFrequency === value}
                      onChange={() =>
                        setForm({ ...form, activityFrequency: value as FormState["activityFrequency"] })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            )}

            <button className="primary" disabled={busy || !progress || !canSubmit}>
              {!progress ? "Starting..." : activeIndex === steps.length - 1 ? "See My Results" : "Continue"}
            </button>
          </form>
        ) : (
          <section className="result">
            <p className="kicker">{result.access === "FULL" ? "Full plan" : "Locked preview"}</p>
            <h1>Your BMI is {result.result.bmi}</h1>
            <p className="support">Category: {result.result.bmiCategory}</p>
            {result.access === "FULL" ? (
              <div className="result-grid">
                <div>
                  <strong>{result.result.dailyCalories}</strong>
                  <span>daily calorie target</span>
                </div>
                <div>
                  <strong>{result.result.targetDate}</strong>
                  <span>predicted goal date</span>
                </div>
                <div>
                  <strong>{result.result.weeksToTarget}</strong>
                  <span>weeks to target</span>
                </div>
              </div>
            ) : (
              <>
                <p className="locked">{result.paywall?.message}</p>
                <button className="primary" onClick={() => setCheckoutOpen(true)} disabled={busy}>
                  Unlock Full Plan
                </button>
              </>
            )}
          </section>
        )}
        <p className="status">{status}</p>
      </section>

      {checkoutOpen && result?.access === "LOCKED" && (
        <div className="checkout-backdrop" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
          <section className="checkout">
            <button
              className="icon-button"
              type="button"
              aria-label="Close checkout"
              onClick={() => setCheckoutOpen(false)}
              disabled={busy}
            >
              x
            </button>
            <p className="kicker">Secure mock checkout</p>
            <h2 id="checkout-title">Unlock your full plan</h2>
            <p className="support">
              Get your complete calorie target, timeline, forecast, and weekly action plan.
            </p>
            <div className="checkout-summary">
              <span>Home Wellness Plan</span>
              <strong>$9.99</strong>
            </div>
            <ul className="unlock-list">
              {(result.paywall?.unlocks ?? [
                "personalized calorie target",
                "target timeline",
                "progress forecast",
                "weekly action plan"
              ]).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <button className="primary" onClick={completeMockPayment} disabled={busy}>
              {busy ? "Processing..." : "Complete Mock Payment"}
            </button>
            <button className="secondary" type="button" onClick={() => setCheckoutOpen(false)} disabled={busy}>
              Not now
            </button>
          </section>
        </div>
      )}

      <aside className="visual">
        <img
          src="https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1200&q=80"
          alt="Pilates workout"
        />
        <div>
          <p>Built around resumable progress, server-side calculations, and subscription-gated results.</p>
          <span>Session: {progress?.sessionId ?? "creating..."}</span>
        </div>
      </aside>
    </main>
  );
}
