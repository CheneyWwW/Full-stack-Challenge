import { describe, expect, it } from "vitest";
import { ValidationProblem } from "@/src/domain/validation";
import { MemoryAssessmentStore } from "@/src/server/memory-store";
import {
  activateSubscription,
  createSession,
  getProgress,
  getResultForAccess,
  saveAssessmentStep,
  submitAssessment
} from "@/src/server/workflows";

async function completeAssessment(store: MemoryAssessmentStore, sessionId: string) {
  let progress = await getProgress(store, sessionId);
  progress = await saveAssessmentStep(store, sessionId, "GENDER", {
    version: progress.version,
    data: { gender: "female" }
  });
  progress = await saveAssessmentStep(store, sessionId, "GOALS", {
    version: progress.version,
    data: {
      primaryGoal: "lose_weight",
      focusAreas: ["belly", "posture"]
    }
  });
  progress = await saveAssessmentStep(store, sessionId, "BODY", {
    version: progress.version,
    data: {
      age: 35,
      heightCm: 165,
      weightKg: 73,
      targetWeightKg: 64
    }
  });
  await saveAssessmentStep(store, sessionId, "ACTIVITY", {
    version: progress.version,
    data: { activityFrequency: "light" }
  });
  return submitAssessment(store, sessionId, new Date("2026-07-09T00:00:00.000Z"));
}

describe("assessment persistence workflow", () => {
  it("supports step-by-step save and progress recovery after interruption", async () => {
    const store = new MemoryAssessmentStore();
    const session = await createSession(store, { sessionId: "resume_case" });

    const genderSaved = await saveAssessmentStep(store, session.sessionId, "GENDER", {
      version: session.version,
      data: { gender: "female" }
    });
    await saveAssessmentStep(store, session.sessionId, "GOALS", {
      version: genderSaved.version,
      data: {
        primaryGoal: "lose_weight",
        focusAreas: ["belly"]
      }
    });

    const recovered = await getProgress(store, session.sessionId);
    expect(recovered.completedSteps).toEqual(["GENDER", "GOALS"]);
    expect(recovered.nextStep).toBe("BODY");
    expect(recovered.draft).toMatchObject({ gender: "female", primaryGoal: "lose_weight" });
  });

  it("handles out-of-order and duplicate step updates consistently", async () => {
    const store = new MemoryAssessmentStore();
    const session = await createSession(store, { sessionId: "concurrent_case" });

    const bodySaved = await saveAssessmentStep(store, session.sessionId, "BODY", {
      version: session.version,
      data: {
        age: 35,
        heightCm: 165,
        weightKg: 73,
        targetWeightKg: 64
      }
    });
    const genderSaved = await saveAssessmentStep(store, session.sessionId, "GENDER", {
      version: bodySaved.version,
      data: { gender: "female" }
    });
    const repeatedGender = await saveAssessmentStep(store, session.sessionId, "GENDER", {
      version: genderSaved.version,
      data: { gender: "non_binary" }
    });

    const goalsSaved = await saveAssessmentStep(store, session.sessionId, "GOALS", {
      version: repeatedGender.version,
      data: {
        primaryGoal: "lose_weight",
        focusAreas: ["belly", "back"]
      }
    });
    await saveAssessmentStep(store, session.sessionId, "ACTIVITY", {
      version: goalsSaved.version,
      data: { activityFrequency: "moderate" }
    });

    const recovered = await getProgress(store, session.sessionId);
    expect(recovered.completedSteps).toEqual(["GENDER", "GOALS", "BODY", "ACTIVITY"]);
    expect(recovered.nextStep).toBeNull();
    expect(recovered.draft.gender).toBe("non_binary");
    expect(recovered.draft.activityFrequency).toBe("moderate");
  });

  it("rejects numeric injection and out-of-range payloads at the API boundary equivalent", async () => {
    const store = new MemoryAssessmentStore();
    const session = await createSession(store, { sessionId: "invalid_case" });

    await expect(
      saveAssessmentStep(store, session.sessionId, "BODY", {
        version: session.version,
        data: {
          age: 35,
          heightCm: "165",
          weightKg: 73,
          targetWeightKg: 64
        }
      })
    ).rejects.toBeInstanceOf(ValidationProblem);

    await expect(
      saveAssessmentStep(store, session.sessionId, "BODY", {
        version: session.version,
        data: {
          age: 12,
          heightCm: 165,
          weightKg: 73,
          targetWeightKg: 64
        }
      })
    ).rejects.toBeInstanceOf(ValidationProblem);
  });
});

describe("subscription-gated result workflow", () => {
  it("returns redacted results to free users and protects the prediction curve", async () => {
    const store = new MemoryAssessmentStore();
    const session = await createSession(store, { sessionId: "free_case" });
    await completeAssessment(store, session.sessionId);

    const result = await getResultForAccess(store, session.sessionId);
    expect(result.access).toBe("LOCKED");
    expect(result.requiresPayment).toBe(true);
    expect(result.result.bmi).toBeDefined();
    expect(result.result.summary).toBeDefined();
    expect(result.result.predictionCurve).toBeUndefined();
    expect(result.result.dailyCalories).toBeUndefined();
    expect(result.result.targetDate).toBeUndefined();
    expect(result.result.bmr).toBeUndefined();
    expect(result.result.tdee).toBeUndefined();
  });

  it("turns a free result into a full result after the /pay callback", async () => {
    const store = new MemoryAssessmentStore();
    const session = await createSession(store, { sessionId: "paid_case" });
    await completeAssessment(store, session.sessionId);

    const before = await getResultForAccess(store, session.sessionId);
    expect(before.access).toBe("LOCKED");

    const payment = await activateSubscription(store, {
      sessionId: session.sessionId,
      idempotencyKey: "evt_paid_case"
    });
    expect(payment).toEqual({ subscriptionStatus: "ACTIVE", idempotent: false });

    const after = await getResultForAccess(store, session.sessionId);
    expect(after.access).toBe("FULL");
    expect(after.requiresPayment).toBe(false);
    expect(after.result.predictionCurve?.length).toBeGreaterThan(4);
    expect(after.result.dailyCalories).toBeGreaterThan(0);
  });

  it("makes repeated payment callbacks idempotent", async () => {
    const store = new MemoryAssessmentStore();
    const session = await createSession(store, { sessionId: "idempotent_pay_case" });
    await completeAssessment(store, session.sessionId);

    await activateSubscription(store, {
      sessionId: session.sessionId,
      idempotencyKey: "evt_repeat"
    });
    const repeated = await activateSubscription(store, {
      sessionId: session.sessionId,
      idempotencyKey: "evt_repeat"
    });

    expect(repeated).toEqual({ subscriptionStatus: "ACTIVE", idempotent: true });
    const result = await getResultForAccess(store, session.sessionId);
    expect(result.access).toBe("FULL");
  });
});
