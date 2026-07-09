import { randomUUID } from "node:crypto";
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
  validateCompleteAssessment
} from "@/src/domain/validation";
import { ConflictError, NotFoundError } from "./errors";
import { AssessmentStore, SessionRecord } from "./store";

export type ProgressResponse = {
  sessionId: string;
  assessmentStatus: "DRAFT" | "COMPLETED";
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

async function requireSession(store: AssessmentStore, sessionId: string): Promise<SessionRecord> {
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
  const data = parseStepData(stepKey, payload);
  const updated = await store.saveStep({
    sessionId,
    stepKey,
    position: stepPosition(stepKey),
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
  if (session.assessmentStatus !== "COMPLETED" || !session.result) {
    throw new ConflictError("Assessment must be submitted before results are available");
  }

  if (session.subscriptionStatus === "ACTIVE") {
    return {
      access: "full",
      requiresPayment: false,
      subscriptionStatus: session.subscriptionStatus,
      result: {
        bmi: session.result.bmi,
        bmiCategory: session.result.bmiCategory,
        dailyCalories: session.result.dailyCalories,
        targetDate: session.result.targetDate,
        weeksToTarget: session.result.weeksToTarget,
        predictionCurve: session.result.predictionCurve
      }
    };
  }

  return {
    access: "preview",
    requiresPayment: true,
    subscriptionStatus: session.subscriptionStatus,
    result: {
      bmi: session.result.bmi,
      bmiCategory: session.result.bmiCategory
    },
    paywall: {
      message: "Upgrade to unlock your calorie target, goal date, and prediction curve.",
      unlocks: ["dailyCalories", "targetDate", "weeksToTarget", "predictionCurve"]
    }
  };
}

export async function activateSubscription(
  store: AssessmentStore,
  payload: unknown
) {
  const data = payload as { sessionId?: unknown; providerEventId?: unknown };
  if (typeof data.sessionId !== "string" || data.sessionId.length < 3) {
    throw new ConflictError("A valid sessionId is required");
  }
  const providerEventId =
    typeof data.providerEventId === "string" && data.providerEventId.length > 0
      ? data.providerEventId
      : `mock_${randomUUID()}`;

  return store.activateSubscription({
    sessionId: data.sessionId,
    providerEventId,
    rawPayload: data
  });
}

export function isStepKey(value: string): value is StepKey {
  return (STEP_ORDER as readonly string[]).includes(value);
}
