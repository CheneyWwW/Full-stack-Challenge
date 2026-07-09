import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

type SessionsRoute = typeof import("@/app/api/v1/sessions/route");
type ProgressRoute = typeof import("@/app/api/v1/sessions/[sessionId]/progress/route");
type StepRoute = typeof import("@/app/api/v1/sessions/[sessionId]/assessment-steps/[stepKey]/route");
type SubmitRoute = typeof import("@/app/api/v1/sessions/[sessionId]/assessment/submit/route");

let sessionsRoute: SessionsRoute;
let progressRoute: ProgressRoute;
let stepRoute: StepRoute;
let submitRoute: SubmitRoute;

beforeAll(async () => {
  process.env.APP_STORE = "memory";
  sessionsRoute = await import("@/app/api/v1/sessions/route");
  progressRoute = await import("@/app/api/v1/sessions/[sessionId]/progress/route");
  stepRoute = await import("@/app/api/v1/sessions/[sessionId]/assessment-steps/[stepKey]/route");
  submitRoute = await import("@/app/api/v1/sessions/[sessionId]/assessment/submit/route");
});

async function readJson(response: Response) {
  return {
    status: response.status,
    body: await response.json()
  };
}

async function createSession() {
  const { status, body } = await readJson(await sessionsRoute.POST());
  expect(status).toBe(201);
  return body as { sessionId: string };
}

function requestWithJson(payload: unknown) {
  return new Request("http://test.local", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function saveStep(sessionId: string, stepKey: string, data: unknown, version: number) {
  return readJson(
    await stepRoute.PATCH(requestWithJson({ version, data }), {
      params: Promise.resolve({ sessionId, stepKey })
    })
  );
}

async function getProgress(sessionId: string) {
  return readJson(
    await progressRoute.GET(new Request("http://test.local"), {
      params: Promise.resolve({ sessionId })
    })
  );
}

async function saveStepWithCurrentVersion(sessionId: string, stepKey: string, data: unknown) {
  const progress = await getProgress(sessionId);
  expect(progress.status).toBe(200);
  return saveStep(sessionId, stepKey, data, progress.body.version);
}

async function submitAssessment(sessionId: string) {
  return readJson(
    await submitRoute.POST(new Request("http://test.local", { method: "POST" }), {
      params: Promise.resolve({ sessionId })
    })
  );
}

describe("persistence API", () => {
  it("returns empty progress after creating a session", async () => {
    const { sessionId } = await createSession();
    const { status, body } = await getProgress(sessionId);

    expect(status).toBe(200);
    expect(body.sessionId).toBe(sessionId);
    expect(body.currentStep).toBeNull();
    expect(body.nextStep).toBe("GENDER");
    expect(body.completedSteps).toEqual([]);
    expect(body.version).toBe(0);
    expect(body.draft).toEqual({});
  });

  it("restores gender after saving the gender step", async () => {
    const { sessionId } = await createSession();

    const saved = await saveStep(sessionId, "gender", { gender: "female" }, 0);
    expect(saved.status).toBe(200);

    const { status, body } = await getProgress(sessionId);
    expect(status).toBe(200);
    expect(body.completedSteps).toEqual(["GENDER"]);
    expect(body.nextStep).toBe("GOALS");
    expect(body.draft.gender).toBe("female");
  });

  it("restores complete draft after saving goal, body metrics, and exercise frequency", async () => {
    const { sessionId } = await createSession();

    await saveStepWithCurrentVersion(sessionId, "gender", { gender: "female" });
    await saveStepWithCurrentVersion(sessionId, "goals", {
      primaryGoal: "lose_weight",
      focusAreas: ["belly", "posture"]
    });
    await saveStepWithCurrentVersion(sessionId, "body", {
      age: 35,
      heightCm: 165,
      weightKg: 73,
      targetWeightKg: 64
    });
    await saveStepWithCurrentVersion(sessionId, "activity", { activityFrequency: "light" });

    const { status, body } = await getProgress(sessionId);
    expect(status).toBe(200);
    expect(body.completedSteps).toEqual(["GENDER", "GOALS", "BODY", "ACTIVITY"]);
    expect(body.nextStep).toBeNull();
    expect(body.draft).toMatchObject({
      gender: "female",
      primaryGoal: "lose_weight",
      focusAreas: ["belly", "posture"],
      age: 35,
      heightCm: 165,
      weightKg: 73,
      targetWeightKg: 64,
      activityFrequency: "light"
    });
  });

  it("does not duplicate completedSteps when submitting the same step with the same data", async () => {
    const { sessionId } = await createSession();

    await saveStepWithCurrentVersion(sessionId, "gender", { gender: "female" });
    await saveStepWithCurrentVersion(sessionId, "gender", { gender: "female" });

    const { body } = await getProgress(sessionId);
    expect(body.completedSteps).toEqual(["GENDER"]);
  });

  it("uses the latest data when the same step is submitted with different data", async () => {
    const { sessionId } = await createSession();

    await saveStepWithCurrentVersion(sessionId, "gender", { gender: "female" });
    await saveStepWithCurrentVersion(sessionId, "gender", { gender: "male" });

    const { body } = await getProgress(sessionId);
    expect(body.completedSteps).toEqual(["GENDER"]);
    expect(body.draft.gender).toBe("male");
  });

  it("allows out-of-order submissions", async () => {
    const { sessionId } = await createSession();

    const bodySave = await saveStep(sessionId, "body", {
      age: 35,
      heightCm: 165,
      weightKg: 73,
      targetWeightKg: 64
    }, 0);
    const genderSave = await saveStepWithCurrentVersion(sessionId, "gender", { gender: "female" });

    expect(bodySave.status).toBe(200);
    expect(genderSave.status).toBe(200);

    const { body } = await getProgress(sessionId);
    expect(body.completedSteps).toEqual(["GENDER", "BODY"]);
    expect(body.nextStep).toBe("GOALS");
    expect(body.draft).toMatchObject({
      gender: "female",
      age: 35,
      heightCm: 165,
      weightKg: 73,
      targetWeightKg: 64
    });
  });

  it("does not move currentStep backward after out-of-order submissions", async () => {
    const { sessionId } = await createSession();

    const bodySave = await saveStep(sessionId, "body", {
      age: 35,
      heightCm: 165,
      weightKg: 73,
      targetWeightKg: 64
    }, 0);
    expect(bodySave.body.currentStep).toBe("BODY");

    const genderSave = await saveStepWithCurrentVersion(sessionId, "gender", { gender: "female" });
    expect(genderSave.body.currentStep).toBe("BODY");

    const { body } = await getProgress(sessionId);
    expect(body.currentStep).toBe("BODY");
  });

  it("returns 400 when sessionId is missing", async () => {
    const { status, body } = await getProgress("");

    expect(status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 404 when sessionId does not exist", async () => {
    const { status, body } = await getProgress(`missing_${randomUUID()}`);

    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it.each([
    ["age = -1", "body", { age: -1, heightCm: 165, weightKg: 73, targetWeightKg: 64 }, "BODY"],
    ["age = 200", "body", { age: 200, heightCm: 165, weightKg: 73, targetWeightKg: 64 }, "BODY"],
    ["heightCm = 0", "body", { age: 35, heightCm: 0, weightKg: 73, targetWeightKg: 64 }, "BODY"],
    ["heightCm = -180", "body", { age: 35, heightCm: -180, weightKg: 73, targetWeightKg: 64 }, "BODY"],
    ["weightKg = 0", "body", { age: 35, heightCm: 165, weightKg: 0, targetWeightKg: 64 }, "BODY"],
    ["weightKg = -60", "body", { age: 35, heightCm: 165, weightKg: -60, targetWeightKg: 64 }, "BODY"],
    ["gender = alien", "gender", { gender: "alien" }, "GENDER"],
    ["exerciseFrequency = every_second", "activity", { exerciseFrequency: "every_second" }, "ACTIVITY"]
  ])("returns 400 and does not persist invalid input: %s", async (_caseName, stepKey, payload, persistedStep) => {
    const { sessionId } = await createSession();

    const rejected = await saveStep(sessionId, stepKey, payload, 0);
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe("VALIDATION_ERROR");

    const { body } = await getProgress(sessionId);
    expect(body.completedSteps).not.toContain(persistedStep);
    expect(body.draft).toEqual({});
  });

  it("rejects targetWeightKg greater than weightKg when the goal is lose_weight and keeps body data clean", async () => {
    const { sessionId } = await createSession();

    const goalSave = await saveStep(sessionId, "goals", {
      primaryGoal: "lose_weight",
      focusAreas: ["belly"]
    }, 0);
    expect(goalSave.status).toBe(200);

    const rejected = await saveStep(sessionId, "body", {
      age: 35,
      heightCm: 165,
      weightKg: 70,
      targetWeightKg: 75
    }, goalSave.body.version);
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe("VALIDATION_ERROR");

    const { body } = await getProgress(sessionId);
    expect(body.completedSteps).toEqual(["GOALS"]);
    expect(body.completedSteps).not.toContain("BODY");
    expect(body.draft).toEqual({
      primaryGoal: "lose_weight",
      focusAreas: ["belly"]
    });
  });

  it("increments version after a successful step save", async () => {
    const { sessionId } = await createSession();

    const saved = await saveStep(sessionId, "gender", { gender: "female" }, 0);

    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(1);
    const progress = await getProgress(sessionId);
    expect(progress.body.version).toBe(1);
  });

  it("returns 409 when an old version tries to update newer data", async () => {
    const { sessionId } = await createSession();

    const first = await saveStep(sessionId, "gender", { gender: "female" }, 0);
    expect(first.body.version).toBe(1);

    const stale = await saveStep(sessionId, "gender", { gender: "male" }, 0);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("CONFLICT");

    const progress = await getProgress(sessionId);
    expect(progress.body.version).toBe(1);
    expect(progress.body.draft.gender).toBe("female");
  });

  it("returns 409 when patching after assessment submission", async () => {
    const { sessionId } = await createSession();

    await saveStep(sessionId, "gender", { gender: "female" }, 0);
    await saveStepWithCurrentVersion(sessionId, "goals", {
      primaryGoal: "lose_weight",
      focusAreas: ["belly"]
    });
    await saveStepWithCurrentVersion(sessionId, "body", {
      age: 35,
      heightCm: 165,
      weightKg: 73,
      targetWeightKg: 64
    });
    await saveStepWithCurrentVersion(sessionId, "activity", { activityFrequency: "light" });

    const submitted = await submitAssessment(sessionId);
    expect(submitted.status).toBe(200);
    expect(submitted.body.progress.assessmentStatus).toBe("RESULT_READY");

    const rejected = await saveStep(sessionId, "gender", { gender: "male" }, submitted.body.progress.version);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe("CONFLICT");
  });

  it("increments version across two consecutive PATCH requests", async () => {
    const { sessionId } = await createSession();

    const first = await saveStep(sessionId, "gender", { gender: "female" }, 0);
    expect(first.body.version).toBe(1);

    const second = await saveStep(sessionId, "goals", {
      primaryGoal: "lose_weight",
      focusAreas: ["belly"]
    }, first.body.version);
    expect(second.body.version).toBe(2);

    const progress = await getProgress(sessionId);
    expect(progress.body.version).toBe(2);
  });
});
