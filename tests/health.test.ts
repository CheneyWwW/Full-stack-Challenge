import { describe, expect, it } from "vitest";
import { calculateHealthEvaluation } from "@/src/domain/health";
import { validateCompleteAssessment, ValidationProblem } from "@/src/domain/validation";
import { CompleteAssessmentInput } from "@/src/domain/types";

const baseInput: CompleteAssessmentInput = {
  gender: "female",
  primaryGoal: "lose_weight",
  focusAreas: ["belly"],
  age: 35,
  heightCm: 165,
  weightKg: 73,
  targetWeightKg: 64,
  activityFrequency: "light"
};

describe("health evaluation algorithm", () => {
  it("calculates BMI, calories, target date, and weekly prediction curve", () => {
    const result = calculateHealthEvaluation(baseInput, new Date("2026-07-09T00:00:00.000Z"));

    expect(result.bmi).toBe(26.81);
    expect(result.bmiCategory).toBe("overweight");
    expect(result.dailyCalories).toBeGreaterThanOrEqual(1200);
    expect(result.weeksToTarget).toBe(15);
    expect(result.targetDate).toBe("2026-10-22");
    expect(result.predictionCurve[0]).toEqual({ week: 0, date: "2026-07-09", weightKg: 73 });
    expect(result.predictionCurve.at(-1)?.weightKg).toBe(64);
  });

  it("rejects missing required body data before calculation", () => {
    expect(() => validateCompleteAssessment({ ...baseInput, age: undefined })).toThrow(
      ValidationProblem
    );
  });

  it("rejects non-numeric and out-of-range height, weight, and age", () => {
    expect(() => validateCompleteAssessment({ ...baseInput, heightCm: "165" } as never)).toThrow(
      ValidationProblem
    );
    expect(() => validateCompleteAssessment({ ...baseInput, heightCm: 119 })).toThrow(
      ValidationProblem
    );
    expect(() => validateCompleteAssessment({ ...baseInput, weightKg: 301 })).toThrow(
      ValidationProblem
    );
    expect(() => validateCompleteAssessment({ ...baseInput, age: 91 })).toThrow(ValidationProblem);
  });

  it("rejects unsafe or contradictory goal weights", () => {
    expect(() => validateCompleteAssessment({ ...baseInput, targetWeightKg: 40 })).toThrow(
      ValidationProblem
    );
    expect(() => validateCompleteAssessment({ ...baseInput, targetWeightKg: 74 })).toThrow(
      ValidationProblem
    );
  });

  it("keeps calorie recommendations above a safety floor", () => {
    const result = calculateHealthEvaluation({
      ...baseInput,
      age: 68,
      heightCm: 150,
      weightKg: 45,
      targetWeightKg: 39
    });

    expect(result.dailyCalories).toBe(1200);
  });
});
