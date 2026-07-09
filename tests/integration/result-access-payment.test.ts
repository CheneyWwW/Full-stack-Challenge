import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaAssessmentStore } from "@/src/server/prisma-store";
import {
  activateSubscription,
  createSession as createWorkflowSession,
  getProgress,
  getResultForAccess,
  saveAssessmentStep,
  submitAssessment as submitWorkflowAssessment
} from "@/src/server/workflows";

type SessionsRoute = typeof import("@/app/api/v1/sessions/route");
type StepRoute = typeof import("@/app/api/v1/sessions/[sessionId]/assessment-steps/[stepKey]/route");
type SubmitRoute = typeof import("@/app/api/v1/sessions/[sessionId]/assessment/submit/route");
type ResultRoute = typeof import("@/app/api/v1/sessions/[sessionId]/results/route");
type PayRoute = typeof import("@/app/pay/route");
type MockCallbackRoute = typeof import("@/app/api/v1/payments/mock-callback/route");

const protectedKeys = [
  "dailyCalories",
  "targetDate",
  "bmr",
  "tdee",
  "predictionCurve",
  "weeklyPlan"
];
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;
const now = new Date("2026-07-09T00:00:00.000Z");

let sessionsRoute: SessionsRoute;
let stepRoute: StepRoute;
let submitRoute: SubmitRoute;
let resultRoute: ResultRoute;
let payRoute: PayRoute;
let mockCallbackRoute: MockCallbackRoute;

async function readJson(response: Response) {
  return {
    status: response.status,
    body: await response.json()
  };
}

function jsonRequest(method: string, payload?: unknown) {
  return new Request("http://test.local", {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
}

async function createApiSession() {
  const response = await readJson(await sessionsRoute.POST());
  expect(response.status).toBe(201);
  return response.body as { sessionId: string; version: number };
}

async function patchApiStep(sessionId: string, stepKey: string, data: unknown, version: number) {
  return readJson(
    await stepRoute.PATCH(jsonRequest("PATCH", { version, data }), {
      params: Promise.resolve({ sessionId, stepKey })
    })
  );
}

async function submitApiAssessment(sessionId: string) {
  return readJson(
    await submitRoute.POST(new Request("http://test.local", { method: "POST" }), {
      params: Promise.resolve({ sessionId })
    })
  );
}

async function getApiResult(sessionId: string, query = "") {
  return readJson(
    await resultRoute.GET(new Request(`http://test.local${query}`), {
      params: Promise.resolve({ sessionId })
    })
  );
}

async function payApi(payload: unknown) {
  return readJson(await payRoute.POST(jsonRequest("POST", payload)));
}

async function mockCallbackApi(payload: unknown) {
  return readJson(await mockCallbackRoute.POST(jsonRequest("POST", payload)));
}

async function createSubmittedApiSession() {
  let progress = await createApiSession();
  let saved = await patchApiStep(progress.sessionId, "gender", { gender: "female" }, progress.version);
  expect(saved.status).toBe(200);
  saved = await patchApiStep(saved.body.sessionId, "goals", {
    primaryGoal: "lose_weight",
    focusAreas: ["belly", "posture"]
  }, saved.body.version);
  expect(saved.status).toBe(200);
  saved = await patchApiStep(saved.body.sessionId, "body", {
    age: 35,
    heightCm: 165,
    weightKg: 73,
    targetWeightKg: 64
  }, saved.body.version);
  expect(saved.status).toBe(200);
  saved = await patchApiStep(saved.body.sessionId, "activity", { activityFrequency: "light" }, saved.body.version);
  expect(saved.status).toBe(200);

  const submitted = await submitApiAssessment(saved.body.sessionId);
  expect(submitted.status).toBe(200);
  return saved.body.sessionId as string;
}

function expectNoProtectedKeys(value: unknown) {
  const text = JSON.stringify(value);
  for (const key of protectedKeys) {
    expect(text).not.toContain(`"${key}"`);
  }
}

describe("result access and payment API", () => {
  beforeAll(async () => {
    process.env.APP_STORE = "memory";
    sessionsRoute = await import("@/app/api/v1/sessions/route");
    stepRoute = await import("@/app/api/v1/sessions/[sessionId]/assessment-steps/[stepKey]/route");
    submitRoute = await import("@/app/api/v1/sessions/[sessionId]/assessment/submit/route");
    resultRoute = await import("@/app/api/v1/sessions/[sessionId]/results/route");
    payRoute = await import("@/app/pay/route");
    mockCallbackRoute = await import("@/app/api/v1/payments/mock-callback/route");
  });

  it("returns a locked, redacted result for an unpaid submitted session", async () => {
    const sessionId = await createSubmittedApiSession();

    const response = await getApiResult(sessionId);

    expect(response.status).toBe(200);
    expect(response.body.access).toBe("LOCKED");
    expect(response.body.subscriptionStatus).not.toBe("ACTIVE");
    expect(response.body.result.bmi).toBeDefined();
    expect(response.body.result.bmiCategory).toBeDefined();
    expect(response.body.result.summary).toBeDefined();
    expect(response.body.paywall.message).toContain("Upgrade");
    for (const key of protectedKeys) {
      expect(response.body.result[key]).toBeUndefined();
    }
    expectNoProtectedKeys(response.body);
  });

  it("ignores query parameters that try to unlock a full result", async () => {
    const sessionId = await createSubmittedApiSession();

    for (const query of [
      "?includeFull=true",
      "?debug=true",
      "?admin=true",
      "?subscriptionStatus=ACTIVE"
    ]) {
      const response = await getApiResult(sessionId, query);
      expect(response.status).toBe(200);
      expect(response.body.access).toBe("LOCKED");
      expectNoProtectedKeys(response.body);
    }
  });

  it("turns a locked result into a full result after /pay", async () => {
    const sessionId = await createSubmittedApiSession();

    const before = await getApiResult(sessionId);
    expect(before.body.access).toBe("LOCKED");

    const paid = await payApi({
      sessionId,
      idempotencyKey: `pay_${sessionId}`
    });
    expect(paid.status).toBe(200);
    expect(paid.body.subscriptionStatus).toBe("ACTIVE");

    const after = await getApiResult(sessionId);
    expect(after.status).toBe(200);
    expect(after.body.access).toBe("FULL");
    expect(after.body.subscriptionStatus).toBe("ACTIVE");
    expect(after.body.result.dailyCalories).toBeDefined();
    expect(after.body.result.targetDate).toBeDefined();
    expect(after.body.result.bmr).toBeDefined();
    expect(after.body.result.tdee).toBeDefined();
    expect(after.body.result.summary).toBeDefined();
    expect(after.body.result.predictionCurve).toBeDefined();
  });

  it("validates mock-callback payloads and rejects payment before result is ready", async () => {
    const missingSession = await mockCallbackApi({ idempotencyKey: "mock_missing_session" });
    expect(missingSession.status).toBe(400);

    const submittedSessionId = await createSubmittedApiSession();
    const missingKey = await mockCallbackApi({ sessionId: submittedSessionId });
    expect(missingKey.status).toBe(400);

    const unknownSession = await mockCallbackApi({
      sessionId: `missing_${randomUUID()}`,
      idempotencyKey: "mock_unknown_session"
    });
    expect(unknownSession.status).toBe(404);

    const draft = await createApiSession();
    const draftPayment = await mockCallbackApi({
      sessionId: draft.sessionId,
      idempotencyKey: `mock_draft_${draft.sessionId}`
    });
    expect(draftPayment.status).toBe(409);
  });

  it("unlocks a submitted session through mock-callback using the shared payment workflow", async () => {
    const sessionId = await createSubmittedApiSession();

    const paid = await mockCallbackApi({
      sessionId,
      idempotencyKey: `mock_success_${sessionId}`
    });
    expect(paid.status).toBe(200);
    expect(paid.body.subscriptionStatus).toBe("ACTIVE");

    const result = await getApiResult(sessionId);
    expect(result.status).toBe(200);
    expect(result.body.access).toBe("FULL");
    expect(result.body.result.dailyCalories).toBeDefined();
    expect(result.body.result.targetDate).toBeDefined();
    expect(result.body.result.bmr).toBeDefined();
    expect(result.body.result.tdee).toBeDefined();
    expect(result.body.result.predictionCurve).toBeDefined();
  });

  it("rejects invalid optional amount and currency values on /pay", async () => {
    const sessionId = await createSubmittedApiSession();

    for (const payload of [
      { sessionId, idempotencyKey: `amount_zero_${sessionId}`, amount: 0 },
      { sessionId, idempotencyKey: `amount_negative_${sessionId}`, amount: -1 },
      { sessionId, idempotencyKey: `amount_string_${sessionId}`, amount: "abc" },
      { sessionId, idempotencyKey: `currency_empty_${sessionId}`, currency: "" },
      { sessionId, idempotencyKey: `currency_xxx_${sessionId}`, currency: "XXX" }
    ]) {
      const response = await payApi(payload);
      expect(response.status).toBe(400);
    }
  });

  it("allows a new event for a different idempotencyKey while keeping subscription ACTIVE", async () => {
    const sessionId = await createSubmittedApiSession();

    const first = await payApi({ sessionId, idempotencyKey: `payment_001_${sessionId}` });
    const repeated = await payApi({ sessionId, idempotencyKey: `payment_001_${sessionId}` });
    const secondEvent = await payApi({ sessionId, idempotencyKey: `payment_002_${sessionId}` });

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ subscriptionStatus: "ACTIVE", idempotent: false });
    expect(repeated.status).toBe(200);
    expect(repeated.body).toEqual({ subscriptionStatus: "ACTIVE", idempotent: true });
    expect(secondEvent.status).toBe(200);
    expect(secondEvent.body).toEqual({ subscriptionStatus: "ACTIVE", idempotent: false });

    const result = await getApiResult(sessionId);
    expect(result.body.access).toBe("FULL");
  });

  it("keeps paid and unpaid submitted sessions isolated", async () => {
    const paidSessionId = await createSubmittedApiSession();
    const unpaidSessionId = await createSubmittedApiSession();

    const paid = await payApi({
      sessionId: paidSessionId,
      idempotencyKey: `isolation_${paidSessionId}`
    });
    expect(paid.status).toBe(200);

    const paidResult = await getApiResult(paidSessionId);
    expect(paidResult.body.access).toBe("FULL");

    const unpaidResult = await getApiResult(unpaidSessionId);
    expect(unpaidResult.body.access).toBe("LOCKED");
    expectNoProtectedKeys(unpaidResult.body);
  });

  it("does not let request payload subscriptionStatus forge access", async () => {
    const sessionId = await createSubmittedApiSession();

    const paid = await payApi({
      sessionId,
      idempotencyKey: `forged_${sessionId}`,
      subscriptionStatus: "ACTIVE"
    });
    expect(paid.status).toBe(200);

    const unpaidSessionId = await createSubmittedApiSession();
    const result = await getApiResult(unpaidSessionId);
    expect(result.body.access).toBe("LOCKED");
    expectNoProtectedKeys(result.body);
  });

  it("returns expected errors for result and payment invalid states", async () => {
    const missingResult = await getApiResult("");
    expect(missingResult.status).toBe(400);

    const unknownResult = await getApiResult(`missing_${randomUUID()}`);
    expect(unknownResult.status).toBe(404);

    const draft = await createApiSession();
    const draftResult = await getApiResult(draft.sessionId);
    expect(draftResult.status).toBe(409);

    const missingPaySession = await payApi({ idempotencyKey: "missing_session" });
    expect(missingPaySession.status).toBe(400);

    const unknownPaySession = await payApi({
      sessionId: `missing_${randomUUID()}`,
      idempotencyKey: "missing_session_pay"
    });
    expect(unknownPaySession.status).toBe(404);

    const draftPay = await payApi({
      sessionId: draft.sessionId,
      idempotencyKey: `draft_${draft.sessionId}`
    });
    expect(draftPay.status).toBe(409);

    const submittedSessionId = await createSubmittedApiSession();
    const missingKey = await payApi({ sessionId: submittedSessionId });
    expect(missingKey.status).toBe(400);

    for (const idempotencyKey of ["", "x".repeat(129), "bad<script>"]) {
      const invalidKey = await payApi({ sessionId: submittedSessionId, idempotencyKey });
      expect(invalidKey.status).toBe(400);
    }
  });
});

describeDb("result access and payment persistence", () => {
  let db: PrismaClient;
  let store: PrismaAssessmentStore;
  let createdSessionIds: string[] = [];

  function testSessionId(label: string) {
    const sessionId = `result_access_${label}_${randomUUID()}`;
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

  async function createSubmittedDbSession(label: string) {
    const sessionId = testSessionId(label);
    await createWorkflowSession(store, { sessionId });
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
    await submitWorkflowAssessment(store, sessionId, now);
    return sessionId;
  }

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

  it("persists ACTIVE subscription state and payment events after payment", async () => {
    const sessionId = await createSubmittedDbSession("pay_closed_loop");

    const before = await getResultForAccess(store, sessionId);
    expect(before.access).toBe("LOCKED");

    const paid = await activateSubscription(store, {
      sessionId,
      idempotencyKey: `idem_${sessionId}`
    });
    expect(paid).toEqual({ subscriptionStatus: "ACTIVE", idempotent: false });

    const user = await db.user.findUniqueOrThrow({
      where: { id: sessionId },
      include: {
        subscription: true,
        paymentEvents: true
      }
    });
    expect(user.subscriptionStatus).toBe("ACTIVE");
    expect(user.subscription?.status).toBe("ACTIVE");
    expect(user.subscription?.activatedAt).not.toBeNull();
    expect(user.subscription?.currentPeriodEnd).not.toBeNull();
    expect(user.paymentEvents).toHaveLength(1);

    const after = await getResultForAccess(store, sessionId);
    expect(after.access).toBe("FULL");
    expect(after.result.dailyCalories).toBeDefined();
    expect(after.result.predictionCurve).toBeDefined();
  });

  it("keeps the same idempotencyKey idempotent and records a new event for a different key", async () => {
    const sessionId = await createSubmittedDbSession("idempotent");
    const idempotencyKey = `payment_001_${sessionId}`;
    const secondKey = `payment_002_${sessionId}`;

    const first = await activateSubscription(store, { sessionId, idempotencyKey });
    const second = await activateSubscription(store, { sessionId, idempotencyKey });
    const third = await activateSubscription(store, { sessionId, idempotencyKey: secondKey });

    expect(first).toEqual({ subscriptionStatus: "ACTIVE", idempotent: false });
    expect(second).toEqual({ subscriptionStatus: "ACTIVE", idempotent: true });
    expect(third).toEqual({ subscriptionStatus: "ACTIVE", idempotent: false });
    const firstEventCount = await db.paymentEvent.count({
      where: {
        userId: sessionId,
        providerEventId: idempotencyKey
      }
    });
    const totalEventCount = await db.paymentEvent.count({
      where: {
        userId: sessionId
      }
    });
    const subscription = await db.subscription.findUniqueOrThrow({
      where: { userId: sessionId }
    });
    expect(firstEventCount).toBe(1);
    expect(totalEventCount).toBe(2);
    expect(subscription.status).toBe("ACTIVE");
  });
});
