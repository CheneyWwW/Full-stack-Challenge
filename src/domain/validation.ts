import { z } from "zod";
import {
  AssessmentDraft,
  CompleteAssessmentInput,
  STEP_ORDER,
  StepData,
  StepKey
} from "./types";

const genderSchema = z
  .object({
    gender: z.enum(["female", "male", "non_binary", "prefer_not_to_say"])
  })
  .strict();

const goalsSchema = z
  .object({
    primaryGoal: z.enum(["lose_weight", "maintain_health", "build_strength", "improve_mobility"]),
    focusAreas: z
      .array(z.enum(["belly", "legs", "arms", "back", "stress", "posture"]))
      .min(1, "Select at least one focus area")
      .max(5, "Select no more than five focus areas")
  })
  .strict();

const bodySchema = z
  .object({
    age: z.number().int().min(13).max(90),
    heightCm: z.number().min(120).max(230),
    weightKg: z.number().min(35).max(300),
    targetWeightKg: z.number().min(35).max(300)
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.targetWeightKg < data.weightKg * 0.75) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetWeightKg"],
        message: "Target weight is too aggressive for a safe plan"
      });
    }
    if (data.targetWeightKg > data.weightKg * 1.25) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetWeightKg"],
        message: "Target weight is too far from current weight"
      });
    }
  });

const activitySchema = z
  .object({
    activityFrequency: z.enum(["sedentary", "light", "moderate", "active"])
  })
  .strict();

export const stepSchemas = {
  GENDER: genderSchema,
  GOALS: goalsSchema,
  BODY: bodySchema,
  ACTIVITY: activitySchema
} as const;

export class ValidationProblem extends Error {
  constructor(
    message: string,
    public readonly issues: unknown
  ) {
    super(message);
    this.name = "ValidationProblem";
  }
}

export function parseStepData(stepKey: StepKey, payload: unknown): StepData {
  const parsed = stepSchemas[stepKey].safeParse(payload);
  if (!parsed.success) {
    throw new ValidationProblem("Invalid assessment step payload", parsed.error.flatten());
  }
  return parsed.data;
}

export function mergeDraftFromSteps(steps: Array<{ stepKey: StepKey; data: StepData }>): AssessmentDraft {
  return steps
    .sort((a, b) => STEP_ORDER.indexOf(a.stepKey) - STEP_ORDER.indexOf(b.stepKey))
    .reduce<AssessmentDraft>((draft, step) => ({ ...draft, ...step.data }), {});
}

export function validateCompleteAssessment(draft: AssessmentDraft): CompleteAssessmentInput {
  const gender = genderSchema.safeParse({ gender: draft.gender });
  const goals = goalsSchema.safeParse({
    primaryGoal: draft.primaryGoal,
    focusAreas: draft.focusAreas
  });
  const body = bodySchema.safeParse({
    age: draft.age,
    heightCm: draft.heightCm,
    weightKg: draft.weightKg,
    targetWeightKg: draft.targetWeightKg
  });
  const activity = activitySchema.safeParse({ activityFrequency: draft.activityFrequency });
  const errors = {
    gender: gender.success ? undefined : gender.error.flatten(),
    goals: goals.success ? undefined : goals.error.flatten(),
    body: body.success ? undefined : body.error.flatten(),
    activity: activity.success ? undefined : activity.error.flatten()
  };

  if (!gender.success || !goals.success || !body.success || !activity.success) {
    throw new ValidationProblem("Assessment is incomplete or invalid", errors);
  }

  const complete: CompleteAssessmentInput = {
    ...gender.data,
    ...goals.data,
    ...body.data,
    ...activity.data
  };

  if (complete.primaryGoal === "lose_weight" && complete.targetWeightKg >= complete.weightKg) {
    throw new ValidationProblem("Goal weight must be lower than current weight for a weight-loss goal", {
      targetWeightKg: ["Must be lower than current weight for lose_weight"]
    });
  }

  return complete;
}
