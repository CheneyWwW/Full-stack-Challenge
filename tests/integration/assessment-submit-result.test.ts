import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaAssessmentStore } from "@/src/server/prisma-store";
import {
  activateSubscription,
  createSession,
  getProgress,
  getResultForAccess,
  saveAssessmentStep,
  submitAssessment
} from "@/src/server/workflows";
import { ValidationProblem } from "@/src/domain/validation";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;
const now = new Date("2026-07-09T00:00:00.000Z");

let db: PrismaClient;
let store: PrismaAssessmentStore;
let createdSessionIds: string[] = [];

function testSessionId(label: string) {
  const sessionId = `submit_result_${label}_${randomUUID()}`;
  createdSessionIds.push(sessionId);
  return sessionId;
}

async function saveStepWithCurrentVersion(sessionId: string, stepKey: string, data: unknown) {
  const progress = await getProgress(store, sessionId);
  return saveAssessmentStep(store, sessionId, stepKey as never, {
    version: progress.version,
    data
  });
}

async function saveCompleteAssessment(sessionId: string) {
  await createSession(store, { sessionId });
  await saveStepWithCurrentVersion(sessionId, "GENDER", { gender: "female" });
  await saveStepWithCurrentVersion(sessionId, "GOALS", {
    primaryGoal: "lose_weight",
    focusAreas: ["belly", "posture"]
  });
  await saveStepWithCurrentVersion(sessionId, "BODY", {
    age: 35,
    heightCm: 165,
    weightKg: 73,
    targetWeightKg: 64
  });
  await saveStepWithCurrentVersion(sessionId, "ACTIVITY", { activityFrequency: "light" });
}

async function resultCountForSession(sessionId: string) {
  return db.healthResult.count({
    where: {
      assessment: {
        userId: sessionId
      }
    }
  });
}

async function createAssessmentWithInvalidDirectBody(sessionId: string) {
  await createSession(store, { sessionId });
  const assessment = await db.assessment.findUniqueOrThrow({
    where: { userId: sessionId },
    select: { id: true }
  });

  await db.assessmentStep.createMany({
    data: [
      {
        assessmentId: assessment.id,
        stepKey: "GENDER",
        position: 0,
        data: { gender: "female" } as Prisma.InputJsonObject
      },
      {
        assessmentId: assessment.id,
        stepKey: "GOALS",
        position: 1,
        data: {
          primaryGoal: "lose_weight",
          focusAreas: ["belly"]
        } as Prisma.InputJsonObject
      },
      {
        assessmentId: assessment.id,
        stepKey: "BODY",
        position: 2,
        data: {
          age: 35,
          heightCm: 0,
          weightKg: 73,
          targetWeightKg: 64
        } as Prisma.InputJsonObject
      },
      {
        assessmentId: assessment.id,
        stepKey: "ACTIVITY",
        position: 3,
        data: { activityFrequency: "light" } as Prisma.InputJsonObject
      }
    ]
  });
}

describeDb("assessment submit result persistence", () => {
  beforeAll(async () => {
    db = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl
        }
      }
    });
    store = new PrismaAssessmentStore(db);
    await db.$connect();
  });

  afterEach(async () => {
    if (createdSessionIds.length === 0) return;
    await db.user.deleteMany({
      where: {
        id: {
          in: createdSessionIds
        }
      }
    });
    createdSessionIds = [];
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it("rejects submit when assessment is incomplete and does not create HealthResult", async () => {
    const sessionId = testSessionId("incomplete");
    await createSession(store, { sessionId });
    await saveStepWithCurrentVersion(sessionId, "GENDER", { gender: "female" });

    await expect(submitAssessment(store, sessionId, now)).rejects.toBeInstanceOf(ValidationProblem);

    expect(await resultCountForSession(sessionId)).toBe(0);
    const assessment = await db.assessment.findUniqueOrThrow({
      where: { userId: sessionId },
      select: { status: true }
    });
    expect(assessment.status).toBe("DRAFT");
  });

  it("persists a HealthResult linked to the current assessment after complete submit", async () => {
    const sessionId = testSessionId("complete");
    await saveCompleteAssessment(sessionId);

    const submitted = await submitAssessment(store, sessionId, now);

    expect(submitted.progress.assessmentStatus).toBe("RESULT_READY");
    expect(submitted.result.bmi).toBe(26.81);
    expect(submitted.result.dailyCalories).toBe(1560);
    expect(submitted.result.targetDate).toBe("2026-11-12");

    const assessment = await db.assessment.findUniqueOrThrow({
      where: { userId: sessionId },
      include: {
        result: true,
        user: true
      }
    });

    expect(assessment.status).toBe("RESULT_READY");
    expect(assessment.result).not.toBeNull();
    expect(assessment.result?.assessmentId).toBe(assessment.id);
    expect(assessment.user.id).toBe(sessionId);
    expect(assessment.result?.bmi).toBe(26.81);
    expect(assessment.result?.dailyCalories).toBe(1560);
    expect(assessment.result?.targetDate.toISOString().slice(0, 10)).toBe("2026-11-12");
    expect(assessment.result?.bmr).toBe(1425.25);
    expect(assessment.result?.tdee).toBe(1959.72);
    expect(assessment.result?.summary).toContain("BMI 26.81");

    const resultWithSession = await db.healthResult.findUniqueOrThrow({
      where: { assessmentId: assessment.id },
      include: {
        assessment: {
          include: {
            user: true
          }
        }
      }
    });
    expect(resultWithSession.assessment.user.id).toBe(sessionId);
  });

  it("does not create duplicate HealthResult rows when submit is repeated", async () => {
    const sessionId = testSessionId("repeat");
    await saveCompleteAssessment(sessionId);

    await submitAssessment(store, sessionId, now);
    await submitAssessment(store, sessionId, now);

    expect(await resultCountForSession(sessionId)).toBe(1);
  });

  it("rejects invalid persisted body data and leaves assessment as DRAFT without a result", async () => {
    const sessionId = testSessionId("invalid_body");
    await createAssessmentWithInvalidDirectBody(sessionId);

    await expect(submitAssessment(store, sessionId, now)).rejects.toBeInstanceOf(ValidationProblem);

    expect(await resultCountForSession(sessionId)).toBe(0);
    const assessment = await db.assessment.findUniqueOrThrow({
      where: { userId: sessionId },
      select: { status: true, completedAt: true }
    });
    expect(assessment.status).toBe("DRAFT");
    expect(assessment.completedAt).toBeNull();
  });

  it("reads the persisted result through the result access workflow after submit", async () => {
    const sessionId = testSessionId("read_result");
    await saveCompleteAssessment(sessionId);
    await submitAssessment(store, sessionId, now);
    await activateSubscription(store, {
      sessionId,
      idempotencyKey: `evt_${sessionId}`
    });

    const result = await getResultForAccess(store, sessionId);

    expect(result.access).toBe("FULL");
    expect(result.result.bmi).toBe(26.81);
    expect(result.result.bmr).toBe(1425.25);
    expect(result.result.tdee).toBe(1959.72);
    expect(result.result.dailyCalories).toBe(1560);
    expect(result.result.targetDate).toBe("2026-11-12");
    expect(result.result.summary).toContain("Recommended daily intake: 1560 kcal");
  });
});
