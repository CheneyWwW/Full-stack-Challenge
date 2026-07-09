import {
  ActivityFrequency,
  BmiCategory,
  CompleteAssessmentInput,
  HealthCalculationInput,
  HealthCalculationResult,
  HealthEvaluation,
  NormalizedGender,
  NormalizedGoal,
  PredictionPoint
} from "./types";
import { validateCompleteAssessment, ValidationProblem } from "./validation";

const activityMultipliers = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725
} as const;

const genderMap: Record<string, NormalizedGender> = {
  female: "female",
  male: "male",
  other: "other",
  non_binary: "other",
  prefer_not_to_say: "other"
};

const goalMap: Record<string, NormalizedGoal> = {
  lose_weight: "lose_weight",
  maintain: "maintain",
  maintain_health: "maintain",
  gain_muscle: "gain_muscle",
  build_strength: "gain_muscle",
  improve_fitness: "improve_fitness",
  improve_mobility: "improve_fitness"
};

type NormalizedHealthInput = {
  age: number;
  gender: NormalizedGender;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  goal: NormalizedGoal;
  exerciseFrequency: ActivityFrequency;
};

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

function maleBmrFor(input: Pick<NormalizedHealthInput, "age" | "heightCm" | "weightKg">): number {
  return 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + 5;
}

function femaleBmrFor(input: Pick<NormalizedHealthInput, "age" | "heightCm" | "weightKg">): number {
  return 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age - 161;
}

function bmrFor(input: NormalizedHealthInput): number {
  if (input.gender === "male") return maleBmrFor(input);
  if (input.gender === "female") return femaleBmrFor(input);
  return (maleBmrFor(input) + femaleBmrFor(input)) / 2;
}

function caloriesFor(tdee: number, goal: NormalizedGoal): number {
  const goalAdjustment = goal === "lose_weight" ? -400 : goal === "gain_muscle" ? 250 : 0;
  return Math.max(1200, Math.round(tdee + goalAdjustment));
}

function predictionCurveFor(input: NormalizedHealthInput, startDate: Date): {
  weeksToTarget: number;
  targetDate: string;
  predictionCurve: PredictionPoint[];
} {
  const effectiveTargetWeight = input.goal === "maintain" ? input.weightKg : input.targetWeightKg;
  const delta = effectiveTargetWeight - input.weightKg;
  const weeksToTarget = delta === 0 ? 0 : Math.ceil(Math.abs(delta) / 0.5);
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

function readFiniteNumber(
  candidate: Record<string, unknown>,
  key: keyof Pick<NormalizedHealthInput, "age" | "heightCm" | "weightKg" | "targetWeightKg">,
  issues: Record<string, string[]>
): number | undefined {
  const value = candidate[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues[key] = ["Must be a finite number"];
    return undefined;
  }
  return value;
}

function normalizeHealthInput(rawInput: HealthCalculationInput): NormalizedHealthInput {
  const candidate = rawInput as Record<string, unknown>;
  const issues: Record<string, string[]> = {};
  const age = readFiniteNumber(candidate, "age", issues);
  const heightCm = readFiniteNumber(candidate, "heightCm", issues);
  const weightKg = readFiniteNumber(candidate, "weightKg", issues);
  const targetWeightKg = readFiniteNumber(candidate, "targetWeightKg", issues);

  if (typeof age === "number" && (!Number.isInteger(age) || age < 13 || age > 90)) {
    issues.age = ["Must be an integer between 13 and 90"];
  }
  if (typeof heightCm === "number" && (heightCm < 120 || heightCm > 230)) {
    issues.heightCm = ["Must be between 120 and 230"];
  }
  if (typeof weightKg === "number" && (weightKg < 35 || weightKg > 300)) {
    issues.weightKg = ["Must be between 35 and 300"];
  }
  if (typeof targetWeightKg === "number" && (targetWeightKg < 35 || targetWeightKg > 300)) {
    issues.targetWeightKg = ["Must be between 35 and 300"];
  }

  const genderValue = candidate.gender;
  const gender = typeof genderValue === "string" ? genderMap[genderValue] : undefined;
  if (!gender) {
    issues.gender = ["Must be one of female, male, or other"];
  }

  const goalValue = candidate.goal ?? candidate.primaryGoal;
  const goal = typeof goalValue === "string" ? goalMap[goalValue] : undefined;
  if (!goal) {
    issues.goal = ["Must be one of lose_weight, maintain, gain_muscle, or improve_fitness"];
  }

  const exerciseValue = candidate.exerciseFrequency ?? candidate.activityFrequency;
  const exerciseFrequency =
    typeof exerciseValue === "string" && exerciseValue in activityMultipliers
      ? (exerciseValue as ActivityFrequency)
      : undefined;
  if (!exerciseFrequency) {
    issues.exerciseFrequency = ["Must be one of sedentary, light, moderate, or active"];
  }

  if (
    goal === "lose_weight" &&
    typeof targetWeightKg === "number" &&
    typeof weightKg === "number" &&
    targetWeightKg >= weightKg
  ) {
    issues.targetWeightKg = ["Must be lower than current weight for lose_weight"];
  }

  if (
    goal === "gain_muscle" &&
    typeof targetWeightKg === "number" &&
    typeof weightKg === "number" &&
    targetWeightKg < weightKg * 0.95
  ) {
    issues.targetWeightKg = ["Should not be much lower than current weight for gain_muscle"];
  }

  if (Object.keys(issues).length > 0) {
    throw new ValidationProblem("Invalid health calculation input", issues);
  }

  return {
    age: age as number,
    gender: gender as NormalizedGender,
    heightCm: heightCm as number,
    weightKg: weightKg as number,
    targetWeightKg: targetWeightKg as number,
    goal: goal as NormalizedGoal,
    exerciseFrequency: exerciseFrequency as ActivityFrequency
  };
}

function summaryFor(result: {
  bmi: number;
  bmiCategory: BmiCategory;
  dailyCalories: number;
  targetDate: string;
}): string {
  return `BMI ${result.bmi} (${result.bmiCategory}). Recommended daily intake: ${result.dailyCalories} kcal. Estimated target date: ${result.targetDate}.`;
}

export function calculateHealthResult(
  rawInput: HealthCalculationInput,
  now = new Date()
): HealthCalculationResult {
  const input = normalizeHealthInput(rawInput);
  const heightM = input.heightCm / 100;
  const bmi = round(input.weightKg / (heightM * heightM));
  const bmr = round(bmrFor(input));
  const tdee = round(bmr * activityMultipliers[input.exerciseFrequency]);
  const dailyCalories = caloriesFor(tdee, input.goal);
  const projection = predictionCurveFor(input, now);
  const result = {
    bmi,
    bmiCategory: bmiCategoryFor(bmi),
    bmr,
    tdee,
    dailyCalories,
    ...projection
  };

  return {
    ...result,
    summary: summaryFor(result)
  };
}

export function calculateHealthEvaluation(
  rawInput: CompleteAssessmentInput,
  now = new Date()
): HealthEvaluation {
  const input = validateCompleteAssessment(rawInput);
  return calculateHealthResult(
    {
      ...input,
      goal: input.primaryGoal,
      exerciseFrequency: input.activityFrequency
    },
    now
  );
}
