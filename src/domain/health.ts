import { BmiCategory, CompleteAssessmentInput, HealthEvaluation, PredictionPoint } from "./types";
import { validateCompleteAssessment } from "./validation";

const activityMultipliers = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725
} as const;

export function bmiCategoryFor(bmi: number): BmiCategory {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function bmrFor(input: CompleteAssessmentInput): number {
  const genderOffset =
    input.gender === "male" ? 5 : input.gender === "female" ? -161 : -78;
  return 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + genderOffset;
}

function caloriesFor(input: CompleteAssessmentInput): number {
  const maintenance = bmrFor(input) * activityMultipliers[input.activityFrequency];
  const goalAdjustment =
    input.primaryGoal === "lose_weight" ? -400 : input.primaryGoal === "build_strength" ? 250 : 0;
  const floor = input.gender === "male" ? 1500 : 1200;
  return Math.max(floor, Math.round(maintenance + goalAdjustment));
}

function predictionCurveFor(input: CompleteAssessmentInput, startDate: Date): {
  weeksToTarget: number;
  targetDate: string;
  predictionCurve: PredictionPoint[];
} {
  const delta = input.targetWeightKg - input.weightKg;
  const weeklyRate = delta < 0 ? -0.6 : delta > 0 ? 0.3 : 0;
  const weeksToTarget = Math.max(4, weeklyRate === 0 ? 4 : Math.ceil(Math.abs(delta / weeklyRate)));
  const targetDate = addDays(startDate, weeksToTarget * 7);

  const predictionCurve = Array.from({ length: weeksToTarget + 1 }, (_, week) => {
    const progress = weeksToTarget === 0 ? 1 : week / weeksToTarget;
    const weightKg = input.weightKg + delta * progress;
    return {
      week,
      date: isoDate(addDays(startDate, week * 7)),
      weightKg: round(weightKg, 1)
    };
  });

  return {
    weeksToTarget,
    targetDate: isoDate(targetDate),
    predictionCurve
  };
}

export function calculateHealthEvaluation(
  rawInput: CompleteAssessmentInput,
  now = new Date()
): HealthEvaluation {
  const input = validateCompleteAssessment(rawInput);
  const heightM = input.heightCm / 100;
  const bmi = round(input.weightKg / (heightM * heightM));
  const projection = predictionCurveFor(input, now);

  return {
    bmi,
    bmiCategory: bmiCategoryFor(bmi),
    dailyCalories: caloriesFor(input),
    ...projection
  };
}
