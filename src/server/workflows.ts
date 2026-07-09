import { calculateHealthEvaluation } from "@/src/domain/health";
import {
  AssessmentDraft,
  PublicResult,
  STEP_ORDER,
  StepData,
  StepKey
} from "@/src/domain/types";
import {
  mergeDraftFromSteps,
  parseStepData,
  validateCompleteAssessment,
  ValidationProblem
} from "@/src/domain/validation";
import { BadRequestError, ConflictError, NotFoundError } from "./errors";
import { AssessmentStore, SessionRecord } from "./store";

export type ProgressResponse = {
  sessionId: string;
  assessmentStatus: SessionRecord["assessmentStatus"];
  currentStep: StepKey | null;
  nextStep: StepKey | null;
  completedSteps: StepKey[];
  version: number;
  draft: AssessmentDraft;
};

function stepPosition(stepKey: StepKey): number {
  return STEP_ORDER.indexOf(stepKey);
}

function nextMissingStep(completedSteps: StepKey[]): StepKey | null {
  return STEP_ORDER.find((step) => !completedSteps.includes(step)) ?? null;
}

function progressFromSession(session: SessionRecord): ProgressResponse {
  const completedSteps = session.steps.map((step) => step.stepKey);
  return {
    sessionId: session.sessionId,
    assessmentStatus: session.assessmentStatus,
    currentStep: session.currentStep,
    nextStep: nextMissingStep(completedSteps),
    completedSteps,
    version: session.version,
    draft: mergeDraftFromSteps(session.steps.map((step) => ({ stepKey: step.stepKey, data: step.data })))
  };
}

function assertSessionId(sessionId: string) {
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    throw new BadRequestError("A valid sessionId is required");
  }
}

function parseVersionedStepPayload(payload: unknown): { expectedVersion: number; data: unknown } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new BadRequestError("Step payload must include version and data");
  }

  const candidate = payload as { version?: unknown; data?: unknown };
  if (typeof candidate.version !== "number" || !Number.isInteger(candidate.version) || candidate.version < 0) {
    throw new BadRequestError("A valid assessment version is required");
  }

  if (!("data" in candidate)) {
    throw new BadRequestError("Step payload must include data");
  }

  return {
    expectedVersion: candidate.version,
    data: candidate.data
  };
}

function assertDraftEditable(session: SessionRecord) {
  if (session.assessmentStatus !== "DRAFT") {
    throw new ConflictError("Assessment can no longer be modified");
  }
}

function assertFreshVersion(session: SessionRecord, expectedVersion: number) {
  if (expectedVersion !== session.version) {
    throw new ConflictError("Assessment version conflict");
  }
}

function mergeDraftWithStep(session: SessionRecord, stepKey: StepKey, data: StepData): AssessmentDraft {
  return mergeDraftFromSteps([
    ...session.steps
      .filter((step) => step.stepKey !== stepKey)
      .map((step) => ({ stepKey: step.stepKey, data: step.data })),
    { stepKey, data }
  ]);
}

function validateDraftConsistency(draft: AssessmentDraft) {
  if (
    draft.primaryGoal === "lose_weight" &&
    typeof draft.weightKg === "number" &&
    typeof draft.targetWeightKg === "number" &&
    draft.targetWeightKg >= draft.weightKg
  ) {
    throw new ValidationProblem("Goal weight must be lower than current weight for a weight-loss goal", {
      targetWeightKg: ["Must be lower than current weight for lose_weight"]
    });
  }
}

async function requireSession(store: AssessmentStore, sessionId: string): Promise<SessionRecord> {
  assertSessionId(sessionId);
  const session = await store.getSession(sessionId);
  if (!session) throw new NotFoundError("Session not found");
  return session;
}

export async function createSession(store: AssessmentStore, options?: { sessionId?: string }) {
  const created = await store.createSession(options);
  const session = await requireSession(store, created.sessionId);
  return progressFromSession(session);
}

export async function getProgress(store: AssessmentStore, sessionId: string): Promise<ProgressResponse> {
  return progressFromSession(await requireSession(store, sessionId));
}

export async function saveAssessmentStep(
  store: AssessmentStore,
  sessionId: string,
  stepKey: StepKey,
  payload: unknown
): Promise<ProgressResponse> {
  assertSessionId(sessionId);
  const { expectedVersion, data: stepPayload } = parseVersionedStepPayload(payload);
  const data = parseStepData(stepKey, stepPayload);
  const session = await requireSession(store, sessionId);
  assertDraftEditable(session);
  assertFreshVersion(session, expectedVersion);
  validateDraftConsistency(mergeDraftWithStep(session, stepKey, data));
  const updated = await store.saveStep({
    sessionId,
    stepKey,
    position: stepPosition(stepKey),
    expectedVersion,
    data
  });
  return progressFromSession(updated);
}

export async function submitAssessment(store: AssessmentStore, sessionId: string, now = new Date()) {
  const session = await requireSession(store, sessionId);
  const draft = mergeDraftFromSteps(session.steps.map((step) => ({ stepKey: step.stepKey, data: step.data })));
  const complete = validateCompleteAssessment(draft);
  const result = calculateHealthEvaluation(complete, now);
  const updated = await store.saveResult(sessionId, result);
  return {
    progress: progressFromSession(updated),
    result
  };
}

export async function getResultForAccess(store: AssessmentStore, sessionId: string): Promise<PublicResult> {
  const session = await requireSession(store, sessionId);
  if (!["RESULT_READY", "COMPLETED"].includes(session.assessmentStatus) || !session.result) {
    throw new ConflictError("Assessment must be submitted before results are available");
  }

  if (session.subscriptionStatus === "ACTIVE") {
    return {
      access: "FULL",
      requiresPayment: false,
      subscriptionStatus: session.subscriptionStatus,
      result: {
        bmi: session.result.bmi,
        bmiCategory: session.result.bmiCategory,
        bmr: session.result.bmr,
        tdee: session.result.tdee,
        dailyCalories: session.result.dailyCalories,
        targetDate: session.result.targetDate,
        summary: session.result.summary,
        weeksToTarget: session.result.weeksToTarget,
        predictionCurve: session.result.predictionCurve
      }
    };
  }

  return {
    access: "LOCKED",
    requiresPayment: true,
    subscriptionStatus: session.subscriptionStatus,
    result: {
      bmi: session.result.bmi,
      bmiCategory: session.result.bmiCategory,
      summary: `Your BMI is ${session.result.bmi} (${session.result.bmiCategory}). Upgrade to unlock your complete personalized plan.`
    },
    paywall: {
      message: "Upgrade to unlock your complete personalized plan.",
      unlocks: [
        "personalized calorie target",
        "target timeline",
        "progress forecast",
        "weekly action plan"
      ]
    }
  };
}

export async function activateSubscription(
  store: AssessmentStore,
  payload: unknown
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new BadRequestError("Payment payload must be an object");
  }

  const data = payload as {
    sessionId?: unknown;
    idempotencyKey?: unknown;
    amount?: unknown;
    currency?: unknown;
  };
  if (typeof data.sessionId !== "string" || data.sessionId.trim().length === 0) {
    throw new BadRequestError("A valid sessionId is required");
  }
  if (
    typeof data.idempotencyKey !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(data.idempotencyKey)
  ) {
    throw new BadRequestError("A valid idempotencyKey is required");
  }
  if ("amount" in data && (typeof data.amount !== "number" || !Number.isFinite(data.amount) || data.amount <= 0)) {
    throw new BadRequestError("Payment amount must be a positive finite number");
  }
  if ("currency" in data && (typeof data.currency !== "string" || data.currency !== "USD")) {
    throw new BadRequestError("Payment currency must be USD");
  }

  const session = await requireSession(store, data.sessionId);
  if (!["RESULT_READY", "COMPLETED"].includes(session.assessmentStatus) || !session.result) {
    throw new ConflictError("Cannot pay before result is ready");
  }

  return store.activateSubscription({
    sessionId: session.sessionId,
    providerEventId: data.idempotencyKey,
    rawPayload: data
  });
}

export function isStepKey(value: string): value is StepKey {
  return (STEP_ORDER as readonly string[]).includes(value);
}
