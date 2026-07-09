export const STEP_ORDER = ["GENDER", "GOALS", "BODY", "ACTIVITY"] as const;

export type StepKey = (typeof STEP_ORDER)[number];

export type Gender = "female" | "male" | "non_binary" | "prefer_not_to_say";
export type PrimaryGoal = "lose_weight" | "maintain_health" | "build_strength" | "improve_mobility";
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

export type BmiCategory = "underweight" | "normal" | "overweight" | "obese";

export type PredictionPoint = {
  week: number;
  date: string;
  weightKg: number;
};

export type HealthEvaluation = {
  bmi: number;
  bmiCategory: BmiCategory;
  dailyCalories: number;
  targetDate: string;
  weeksToTarget: number;
  predictionCurve: PredictionPoint[];
};

export type SubscriptionStatus = "FREE" | "ACTIVE" | "EXPIRED" | "CANCELED";

export type PublicResult = {
  access: "preview" | "full";
  requiresPayment: boolean;
  subscriptionStatus: SubscriptionStatus;
  result: {
    bmi: number;
    bmiCategory: BmiCategory;
    dailyCalories?: number;
    targetDate?: string;
    weeksToTarget?: number;
    predictionCurve?: PredictionPoint[];
  };
  paywall?: {
    message: string;
    unlocks: string[];
  };
};
