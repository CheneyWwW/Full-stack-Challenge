import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

type SessionsRoute = typeof import("@/app/api/v1/sessions/route");
type ProgressRoute = typeof import("@/app/api/v1/sessions/[sessionId]/progress/route");
type StepRoute = typeof import("@/app/api/v1/sessions/[sessionId]/assessment-steps/[stepKey]/route");

let sessionsRoute: SessionsRoute;
let progressRoute: ProgressRoute;
let stepRoute: StepRoute;

beforeAll(async () => {
  process.env.APP_STORE = "memory";
  sessionsRoute = await import("@/app/api/v1/sessions/route");
  progressRoute = await import("@/app/api/v1/sessions/[sessionId]/progress/route");
  stepRoute = await import("@/app/api/v1/sessions/[sessionId]/assessment-steps/[stepKey]/route");
});

async function readJson(response: Response) {
  return {
    status: response.status,
    body: await response.json()
  };
}

async function createSession() {
  const response = await readJson(await sessionsRoute.POST());
  expect(response.status).toBe(201);
  return response.body as { sessionId: string; version: number };
}

function jsonPatch(payload: unknown) {
  return new Request("http://test.local", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function saveStep(sessionId: string, stepKey: string, payload: unknown) {
  return readJson(
    await stepRoute.PATCH(jsonPatch(payload), {
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

describe("persistence API validation gaps", () => {
  it("returns 400 when version is missing", async () => {
    const session = await createSession();

    const response = await saveStep(session.sessionId, "gender", {
      data: { gender: "female" }
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 400 when data is missing", async () => {
    const session = await createSession();

    const response = await saveStep(session.sessionId, "gender", {
      version: session.version
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it("returns 400 for an unknown stepKey", async () => {
    const session = await createSession();

    const response = await saveStep(session.sessionId, "unknown_step", {
      version: session.version,
      data: { value: true }
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BAD_REQUEST");
  });

  it.each([
    ["heightCm as string", { age: 35, heightCm: "180", weightKg: 73, targetWeightKg: 64 }],
    ["heightCm as null", { age: 35, heightCm: null, weightKg: 73, targetWeightKg: 64 }],
    ["weightKg as object", { age: 35, heightCm: 165, weightKg: { value: 73 }, targetWeightKg: 64 }],
    ["targetWeightKg as array", { age: 35, heightCm: 165, weightKg: 73, targetWeightKg: [64] }]
  ])("rejects malformed numeric body payloads: %s", async (_caseName, data) => {
    const session = await createSession();

    const response = await saveStep(session.sessionId, "body", {
      version: session.version,
      data
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    const progress = await getProgress(session.sessionId);
    expect(progress.body.completedSteps).not.toContain("BODY");
    expect(progress.body.draft).toEqual({});
  });

  it("rejects malformed JSON numeric injections without mutating progress", async () => {
    const session = await createSession();
    const request = new Request("http://test.local", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: '{"version":0,"data":{"age":35,"heightCm":NaN,"weightKg":73,"targetWeightKg":64}}'
    });

    const response = await readJson(
      await stepRoute.PATCH(request, {
        params: Promise.resolve({ sessionId: session.sessionId, stepKey: "body" })
      })
    );

    expect(response.status).toBe(400);
    const progress = await getProgress(session.sessionId);
    expect(progress.body.completedSteps).toEqual([]);
    expect(progress.body.draft).toEqual({});
  });

  it.each(["../../admin", "<script>alert(1)</script>", `missing_${randomUUID()}`])(
    "does not resolve unsafe sessionId values: %s",
    async (sessionId) => {
      const response = await getProgress(sessionId);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    }
  );
});
