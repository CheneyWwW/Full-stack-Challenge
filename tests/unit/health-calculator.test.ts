import { describe, expect, it } from "vitest";
import { calculateHealthResult } from "@/src/domain/health";
import { HealthCalculationInput } from "@/src/domain/types";
import { ValidationProblem } from "@/src/domain/validation";

const now = new Date("2026-07-09T00:00:00.000Z");

const baseInput: HealthCalculationInput = {
  age: 30,
  gender: "male",
  heightCm: 180,
  weightKg: 80,
  targetWeightKg: 75,
  goal: "lose_weight",
  exerciseFrequency: "moderate"
};

function withInput(overrides: Partial<HealthCalculationInput>): HealthCalculationInput {
  return {
    ...baseInput,
    ...overrides
  };
}

function expectInvalid(overrides: Record<string, unknown>) {
  expect(() =>
    calculateHealthResult(
      {
        ...baseInput,
        ...overrides
      } as HealthCalculationInput,
      now
    )
  ).toThrow(ValidationProblem);
}

describe("calculateHealthResult", () => {
  it("calculates BMI, BMR, TDEE, calories, and target date for a male user", () => {
    const result = calculateHealthResult(baseInput, now);

    expect(result.bmi).toBe(24.69);
    expect(result.bmiCategory).toBe("normal");
    expect(result.bmr).toBe(1780);
    expect(result.tdee).toBe(2759);
    expect(result.dailyCalories).toBe(2359);
    expect(result.weeksToTarget).toBe(10);
    expect(result.targetDate).toBe("2026-09-17");
    expect(result.summary).toContain("BMI 24.69");
  });

  it("calculates the female BMR path", () => {
    const result = calculateHealthResult(
      withInput({
        age: 35,
        gender: "female",
        heightCm: 165,
        weightKg: 73,
        targetWeightKg: 64,
        exerciseFrequency: "light"
      }),
      now
    );

    expect(result.bmi).toBe(26.81);
    expect(result.bmiCategory).toBe("overweight");
    expect(result.bmr).toBe(1425.25);
    expect(result.tdee).toBe(1959.72);
    expect(result.dailyCalories).toBe(1560);
    expect(result.weeksToTarget).toBe(18);
    expect(result.targetDate).toBe("2026-11-12");
  });

  it("uses the average of male and female BMR for other gender values", () => {
    const result = calculateHealthResult(
      withInput({
        gender: "other",
        targetWeightKg: 80,
        goal: "maintain",
        exerciseFrequency: "sedentary"
      }),
      now
    );

    expect(result.bmr).toBe(1697);
    expect(result.tdee).toBe(2036.4);
    expect(result.dailyCalories).toBe(2036);
  });

  it("maps legacy gender values to other", () => {
    const nonBinary = calculateHealthResult(withInput({ gender: "non_binary" }), now);
    const preferNot = calculateHealthResult(withInput({ gender: "prefer_not_to_say" }), now);
    const other = calculateHealthResult(withInput({ gender: "other" }), now);

    expect(nonBinary.bmr).toBe(other.bmr);
    expect(preferNot.bmr).toBe(other.bmr);
  });

  it("uses exercise frequency to change TDEE", () => {
    const sedentary = calculateHealthResult(
      withInput({ exerciseFrequency: "sedentary", targetWeightKg: 75 }),
      now
    );
    const active = calculateHealthResult(
      withInput({ exerciseFrequency: "active", targetWeightKg: 75 }),
      now
    );

    expect(active.tdee).toBeGreaterThan(sedentary.tdee);
  });

  it("lowers calories for lose_weight and raises calories for gain_muscle", () => {
    const maintain = calculateHealthResult(
      withInput({ goal: "maintain", targetWeightKg: 80 }),
      now
    );
    const loseWeight = calculateHealthResult(baseInput, now);
    const gainMuscle = calculateHealthResult(
      withInput({ goal: "gain_muscle", targetWeightKg: 83 }),
      now
    );

    expect(loseWeight.dailyCalories).toBe(maintain.dailyCalories - 400);
    expect(gainMuscle.dailyCalories).toBe(maintain.dailyCalories + 250);
  });

  it("maps legacy goals to the normalized goal behavior", () => {
    const maintain = calculateHealthResult(withInput({ goal: "maintain", targetWeightKg: 80 }), now);
    const maintainHealth = calculateHealthResult(
      withInput({ primaryGoal: "maintain_health", goal: undefined, targetWeightKg: 80 }),
      now
    );
    const gainMuscle = calculateHealthResult(withInput({ goal: "gain_muscle", targetWeightKg: 83 }), now);
    const buildStrength = calculateHealthResult(
      withInput({ primaryGoal: "build_strength", goal: undefined, targetWeightKg: 83 }),
      now
    );

    expect(maintainHealth.dailyCalories).toBe(maintain.dailyCalories);
    expect(buildStrength.dailyCalories).toBe(gainMuscle.dailyCalories);
  });

  it.each([
    [18.4, "underweight"],
    [18.5, "normal"],
    [24.9, "normal"],
    [25.0, "overweight"],
    [29.9, "overweight"],
    [30.0, "obese"]
  ] as const)("classifies BMI %s as %s", (bmi, category) => {
    const weightKg = bmi * 4;
    const result = calculateHealthResult(
      withInput({
        heightCm: 200,
        weightKg,
        targetWeightKg: weightKg,
        goal: "maintain"
      }),
      now
    );

    expect(result.bmi).toBe(bmi);
    expect(result.bmiCategory).toBe(category);
  });

  it.each([
    ["age missing", { age: undefined }],
    ["age = 0", { age: 0 }],
    ["age = -1", { age: -1 }],
    ["age = 200", { age: 200 }],
    ["age = abc", { age: "abc" }],
    ["heightCm missing", { heightCm: undefined }],
    ["heightCm = 0", { heightCm: 0 }],
    ["heightCm = -180", { heightCm: -180 }],
    ["heightCm = 999", { heightCm: 999 }],
    ["heightCm = NaN", { heightCm: Number.NaN }],
    ["heightCm = Infinity", { heightCm: Number.POSITIVE_INFINITY }],
    ["weightKg missing", { weightKg: undefined }],
    ["weightKg = 0", { weightKg: 0 }],
    ["weightKg = -60", { weightKg: -60 }],
    ["weightKg = 500", { weightKg: 500 }],
    ["weightKg = NaN", { weightKg: Number.NaN }],
    ["weightKg = Infinity", { weightKg: Number.POSITIVE_INFINITY }],
    ["targetWeightKg missing", { targetWeightKg: undefined }],
    ["targetWeightKg = 0", { targetWeightKg: 0 }],
    ["targetWeightKg = -50", { targetWeightKg: -50 }],
    ["targetWeightKg = 500", { targetWeightKg: 500 }],
    ["gender = alien", { gender: "alien" }],
    ["goal = unknown_goal", { goal: "unknown_goal" }],
    ["exerciseFrequency = every_second", { exerciseFrequency: "every_second" }]
  ])("rejects invalid input: %s", (_caseName, overrides) => {
    expectInvalid(overrides);
  });

  it("rejects targetWeightKg above current weight for lose_weight", () => {
    expectInvalid({ goal: "lose_weight", weightKg: 80, targetWeightKg: 85 });
  });

  it("rejects a clearly lower targetWeightKg for gain_muscle", () => {
    expectInvalid({ goal: "gain_muscle", weightKg: 80, targetWeightKg: 70 });
  });

  it("keeps dailyCalories above the safety floor", () => {
    const result = calculateHealthResult(
      withInput({
        age: 68,
        gender: "female",
        heightCm: 150,
        weightKg: 45,
        targetWeightKg: 39,
        exerciseFrequency: "sedentary"
      }),
      now
    );

    expect(result.dailyCalories).toBe(1200);
  });

  it("handles a target weight equal to current weight without negative time", () => {
    const result = calculateHealthResult(
      withInput({
        goal: "maintain",
        weightKg: 80,
        targetWeightKg: 80
      }),
      now
    );

    expect(result.weeksToTarget).toBe(0);
    expect(result.targetDate).toBe("2026-07-09");
    expect(result.predictionCurve).toEqual([{ week: 0, date: "2026-07-09", weightKg: 80 }]);
  });
});
