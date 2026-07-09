export const STEP_ORDER = ["GENDER", "GOALS", "BODY", "ACTIVITY"] as const;

export type StepKey = (typeof STEP_ORDER)[number];

export type Gender = "female" | "male" | "other" | "non_binary" | "prefer_not_to_say";
export type NormalizedGender = "female" | "male" | "other";
export type PrimaryGoal =
  | "lose_weight"
  | "maintain"
  | "gain_muscle"
  | "improve_fitness"
  | "maintain_health"
  | "build_strength"
  | "improve_mobility";
export type NormalizedGoal = "lose_weight" | "maintain" | "gain_muscle" | "improve_fitness";
export type FocusArea = "belly" | "legs" | "arms" | "back" | "stress" | "posture";
export type ActivityFrequency = "sedentary" | "light" | "moderate" | "active";

export type GenderStepData = {
  gender: Gender;
};

export type GoalsStepData = {
  primaryGoal: PrimaryGoal;
  focusAreas: FocusArea[];
};

export type BodyStepData = {
  age: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
};

export type ActivityStepData = {
  activityFrequency: ActivityFrequency;
};

export type StepData = GenderStepData | GoalsStepData | BodyStepData | ActivityStepData;

export type AssessmentDraft = Partial<GenderStepData & GoalsStepData & BodyStepData & ActivityStepData>;

export type CompleteAssessmentInput = GenderStepData & GoalsStepData & BodyStepData & ActivityStepData;

export type HealthCalculationInput = BodyStepData & {
  gender: Gender;
  goal?: PrimaryGoal;
  primaryGoal?: PrimaryGoal;
  exerciseFrequency?: ActivityFrequency;
  activityFrequency?: ActivityFrequency;
};

export type BmiCategory = "underweight" | "normal" | "overweight" | "obese";

export type PredictionPoint = {
  week: number;
  date: string;
  weightKg: number;
};

export type HealthEvaluation = {
  bmi: number;
  bmiCategory: BmiCategory;
  bmr?: number;
  tdee?: number;
  dailyCalories: number;
  targetDate: string;
  summary?: string;
  weeksToTarget: number;
  predictionCurve: PredictionPoint[];
};

export type HealthCalculationResult = HealthEvaluation & {
  bmr: number;
  tdee: number;
  summary: string;
};

export type SubscriptionStatus = "FREE" | "ACTIVE" | "EXPIRED" | "CANCELED";

export type PublicResult = {
  access: "LOCKED" | "FULL";
  requiresPayment: boolean;
  subscriptionStatus: SubscriptionStatus;
  result: {
    bmi: number;
    bmiCategory: BmiCategory;
    bmr?: number;
    tdee?: number;
    dailyCalories?: number;
    targetDate?: string;
    summary?: string;
    weeksToTarget?: number;
    predictionCurve?: PredictionPoint[];
  };
  paywall?: {
    message: string;
    unlocks: string[];
  };
};
