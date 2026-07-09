import { beforeAll, describe, expect, it } from "vitest";

type SessionsRoute = typeof import("@/app/api/v1/sessions/route");
type ProgressRoute = typeof import("@/app/api/v1/sessions/[sessionId]/progress/route");
type StepRoute = typeof import("@/app/api/v1/sessions/[sessionId]/assessment-steps/[stepKey]/route");
type SubmitRoute = typeof import("@/app/api/v1/sessions/[sessionId]/assessment/submit/route");
type ResultRoute = typeof import("@/app/api/v1/sessions/[sessionId]/results/route");
type PayRoute = typeof import("@/app/pay/route");

const protectedKeys = [
  "dailyCalories",
  "targetDate",
  "bmr",
  "tdee",
  "predictionCurve",
  "weeklyPlan"
];

let sessionsRoute: SessionsRoute;
let progressRoute: ProgressRoute;
let stepRoute: StepRoute;
let submitRoute: SubmitRoute;
let resultRoute: ResultRoute;
let payRoute: PayRoute;

beforeAll(async () => {
  process.env.APP_STORE = "memory";
  sessionsRoute = await import("@/app/api/v1/sessions/route");
  progressRoute = await import("@/app/api/v1/sessions/[sessionId]/progress/route");
  stepRoute = await import("@/app/api/v1/sessions/[sessionId]/assessment-steps/[stepKey]/route");
  submitRoute = await import("@/app/api/v1/sessions/[sessionId]/assessment/submit/route");
  resultRoute = await import("@/app/api/v1/sessions/[sessionId]/results/route");
  payRoute = await import("@/app/pay/route");
});

async function readJson(response: Response) {
  return {
    status: response.status,
    body: await response.json()
  };
}

function request(method: string, payload?: unknown) {
  return new Request("http://test.local", {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
}

function expectNoProtectedFields(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const key of protectedKeys) {
    expect(serialized).not.toContain(`"${key}"`);
  }
}

async function patchStep(sessionId: string, stepKey: string, version: number, data: unknown) {
  return readJson(
    await stepRoute.PATCH(request("PATCH", { version, data }), {
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

async function getResult(sessionId: string) {
  return readJson(
    await resultRoute.GET(new Request("http://test.local"), {
      params: Promise.resolve({ sessionId })
    })
  );
}

describe("full API funnel flow", () => {
  it("saves assessment steps, restores progress, submits, gates results, pays, and unlocks full results", async () => {
    let progress = await readJson(await sessionsRoute.POST());
    expect(progress.status).toBe(201);
    const sessionId = progress.body.sessionId as string;

    progress = await patchStep(sessionId, "gender", progress.body.version, { gender: "female" });
    expect(progress.status).toBe(200);

    progress = await patchStep(sessionId, "goals", progress.body.version, {
      primaryGoal: "lose_weight",
      focusAreas: ["belly", "posture"]
    });
    expect(progress.status).toBe(200);

    progress = await patchStep(sessionId, "body", progress.body.version, {
      age: 35,
      heightCm: 165,
      weightKg: 73,
      targetWeightKg: 64
    });
    expect(progress.status).toBe(200);

    progress = await patchStep(sessionId, "activity", progress.body.version, {
      activityFrequency: "light"
    });
    expect(progress.status).toBe(200);

    const restored = await getProgress(sessionId);
    expect(restored.status).toBe(200);
    expect(restored.body.completedSteps).toEqual(["GENDER", "GOALS", "BODY", "ACTIVITY"]);
    expect(restored.body.nextStep).toBeNull();
    expect(restored.body.draft).toMatchObject({
      gender: "female",
      primaryGoal: "lose_weight",
      age: 35,
      heightCm: 165,
      weightKg: 73,
      targetWeightKg: 64,
      activityFrequency: "light"
    });

    const submitted = await readJson(
      await submitRoute.POST(request("POST"), {
        params: Promise.resolve({ sessionId })
      })
    );
    expect(submitted.status).toBe(200);
    expect(submitted.body.progress.assessmentStatus).toBe("RESULT_READY");

    const locked = await getResult(sessionId);
    expect(locked.status).toBe(200);
    expect(locked.body.access).toBe("LOCKED");
    expect(locked.body.result.bmi).toBeDefined();
    expect(locked.body.result.summary).toBeDefined();
    expectNoProtectedFields(locked.body);

    const paid = await readJson(
      await payRoute.POST(request("POST", {
        sessionId,
        idempotencyKey: `e2e_${sessionId}`
      }))
    );
    expect(paid.status).toBe(200);
    expect(paid.body.subscriptionStatus).toBe("ACTIVE");

    const full = await getResult(sessionId);
    expect(full.status).toBe(200);
    expect(full.body.access).toBe("FULL");
    expect(full.body.result.dailyCalories).toBeDefined();
    expect(full.body.result.targetDate).toBeDefined();
    expect(full.body.result.bmr).toBeDefined();
    expect(full.body.result.tdee).toBeDefined();
    expect(full.body.result.predictionCurve).toBeDefined();
  });
});
