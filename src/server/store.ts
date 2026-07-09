import {
  HealthEvaluation,
  StepData,
  StepKey,
  SubscriptionStatus
} from "@/src/domain/types";

export type AssessmentStatus = "DRAFT" | "SUBMITTED" | "RESULT_READY" | "COMPLETED";

export type StoredStep = {
  stepKey: StepKey;
  data: StepData;
  position: number;
  version: number;
  updatedAt: string;
};

export type StoredResult = HealthEvaluation & {
  createdAt: string;
};

export type SessionRecord = {
  sessionId: string;
  assessmentId: string;
  assessmentStatus: AssessmentStatus;
  currentStep: StepKey | null;
  version: number;
  subscriptionStatus: SubscriptionStatus;
  steps: StoredStep[];
  result: StoredResult | null;
};

export type SaveStepInput = {
  sessionId: string;
  stepKey: StepKey;
  position: number;
  expectedVersion: number;
  data: StepData;
};

export type PaymentActivationInput = {
  sessionId: string;
  providerEventId: string;
  rawPayload: unknown;
};

export type PaymentActivationResult = {
  subscriptionStatus: SubscriptionStatus;
  idempotent: boolean;
};

export interface AssessmentStore {
  createSession(options?: { sessionId?: string }): Promise<{ sessionId: string }>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
  saveStep(input: SaveStepInput): Promise<SessionRecord>;
  saveResult(sessionId: string, result: HealthEvaluation): Promise<SessionRecord>;
  activateSubscription(input: PaymentActivationInput): Promise<PaymentActivationResult>;
}
