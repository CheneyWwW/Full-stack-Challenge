import { randomUUID } from "node:crypto";
import { HealthEvaluation, STEP_ORDER, StepData, StepKey, SubscriptionStatus } from "@/src/domain/types";
import { ConflictError, NotFoundError } from "./errors";
import {
  AssessmentStore,
  PaymentActivationInput,
  PaymentActivationResult,
  SaveStepInput,
  SessionRecord,
  StoredResult,
  StoredStep
} from "./store";

type MutableSession = Omit<SessionRecord, "steps" | "result"> & {
  steps: Map<StepKey, StoredStep>;
  result: StoredResult | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function cloneSession(session: MutableSession): SessionRecord {
  return {
    ...session,
    steps: Array.from(session.steps.values()).sort((a, b) => a.position - b.position),
    result: session.result ? { ...session.result, predictionCurve: [...session.result.predictionCurve] } : null
  };
}

function furthestStep(currentStep: StepKey | null, nextStep: StepKey): StepKey {
  if (!currentStep) return nextStep;
  return STEP_ORDER.indexOf(nextStep) > STEP_ORDER.indexOf(currentStep) ? nextStep : currentStep;
}

export class MemoryAssessmentStore implements AssessmentStore {
  private sessions = new Map<string, MutableSession>();
  private paymentEvents = new Map<string, string>();

  async createSession(options?: { sessionId?: string }): Promise<{ sessionId: string }> {
    const sessionId = options?.sessionId ?? randomUUID();
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        sessionId,
        assessmentId: randomUUID(),
        assessmentStatus: "DRAFT",
        currentStep: null,
        version: 0,
        subscriptionStatus: "FREE",
        steps: new Map(),
        result: null
      });
    }
    return { sessionId };
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(sessionId);
    return session ? cloneSession(session) : null;
  }

  async saveStep(input: SaveStepInput): Promise<SessionRecord> {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw new NotFoundError("Session not found");
    if (session.assessmentStatus !== "DRAFT") {
      throw new ConflictError("Assessment can no longer be modified");
    }
    if (input.expectedVersion !== session.version) {
      throw new ConflictError("Assessment version conflict");
    }

    const existing = session.steps.get(input.stepKey);
    session.steps.set(input.stepKey, {
      stepKey: input.stepKey,
      data: structuredClone(input.data) as StepData,
      position: input.position,
      version: existing ? existing.version + 1 : 1,
      updatedAt: nowIso()
    });
    session.currentStep = furthestStep(session.currentStep, input.stepKey);
    session.version += 1;
    return cloneSession(session);
  }

  async saveResult(sessionId: string, result: HealthEvaluation): Promise<SessionRecord> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError("Session not found");

    session.result = {
      ...result,
      predictionCurve: [...result.predictionCurve],
      createdAt: nowIso()
    };
    session.assessmentStatus = "RESULT_READY";
    session.version += 1;
    return cloneSession(session);
  }

  async activateSubscription(input: PaymentActivationInput): Promise<PaymentActivationResult> {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw new NotFoundError("Session not found");

    const existingSessionId = this.paymentEvents.get(input.providerEventId);
    if (existingSessionId) {
      if (existingSessionId === input.sessionId) {
        session.subscriptionStatus = "ACTIVE";
        return { subscriptionStatus: "ACTIVE", idempotent: true };
      }
      throw new ConflictError("Payment event belongs to another session");
    }

    this.paymentEvents.set(input.providerEventId, input.sessionId);
    session.subscriptionStatus = "ACTIVE";
    return { subscriptionStatus: "ACTIVE", idempotent: false };
  }
}
