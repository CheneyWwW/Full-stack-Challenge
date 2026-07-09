import { PrismaClient } from "@prisma/client";
import { BmiCategory, HealthEvaluation, StepData, StepKey, SubscriptionStatus } from "@/src/domain/types";
import { NotFoundError } from "./errors";
import {
  AssessmentStore,
  PaymentActivationInput,
  PaymentActivationResult,
  SaveStepInput,
  SessionRecord,
  StoredStep
} from "./store";

function toStoredStep(step: {
  stepKey: StepKey;
  data: unknown;
  position: number;
  version: number;
  updatedAt: Date;
}): StoredStep {
  return {
    stepKey: step.stepKey,
    data: step.data as StepData,
    position: step.position,
    version: step.version,
    updatedAt: step.updatedAt.toISOString()
  };
}

function toSubscriptionStatus(status: string): SubscriptionStatus {
  return status as SubscriptionStatus;
}

export class PrismaAssessmentStore implements AssessmentStore {
  constructor(private readonly db: PrismaClient) {}

  async createSession(options?: { sessionId?: string }): Promise<{ sessionId: string }> {
    const user = await this.db.user.create({
      data: {
        ...(options?.sessionId ? { id: options.sessionId } : {}),
        subscription: {
          create: {}
        },
        assessment: {
          create: {}
        }
      },
      select: { id: true }
    });
    return { sessionId: user.id };
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const user = await this.db.user.findUnique({
      where: { id: sessionId },
      include: {
        subscription: true,
        assessment: {
          include: {
            steps: { orderBy: { position: "asc" } },
            result: true
          }
        }
      }
    });
    if (!user || !user.assessment) return null;

    return {
      sessionId: user.id,
      assessmentId: user.assessment.id,
      assessmentStatus: user.assessment.status,
      currentStep: user.assessment.currentStep,
      version: user.assessment.version,
      subscriptionStatus: toSubscriptionStatus(user.subscription?.status ?? user.subscriptionStatus),
      steps: user.assessment.steps.map(toStoredStep),
      result: user.assessment.result
        ? {
            bmi: user.assessment.result.bmi,
            bmiCategory: user.assessment.result.bmiCategory as BmiCategory,
            dailyCalories: user.assessment.result.dailyCalories,
            targetDate: user.assessment.result.targetDate.toISOString().slice(0, 10),
            weeksToTarget: user.assessment.result.weeksToTarget,
            predictionCurve: user.assessment.result.predictionCurve as never,
            createdAt: user.assessment.result.createdAt.toISOString()
          }
        : null
    };
  }

  async saveStep(input: SaveStepInput): Promise<SessionRecord> {
    const session = await this.db.$transaction(async (tx: any) => {
      const user = await tx.user.findUnique({
        where: { id: input.sessionId },
        include: { assessment: true }
      });
      if (!user || !user.assessment) throw new NotFoundError("Session not found");

      await tx.assessmentStep.upsert({
        where: {
          assessmentId_stepKey: {
            assessmentId: user.assessment.id,
            stepKey: input.stepKey
          }
        },
        create: {
          assessmentId: user.assessment.id,
          stepKey: input.stepKey,
          position: input.position,
          data: input.data as never
        },
        update: {
          position: input.position,
          data: input.data as never,
          version: { increment: 1 },
          completedAt: new Date()
        }
      });

      await tx.assessment.update({
        where: { id: user.assessment.id },
        data: {
          currentStep: input.stepKey,
          version: { increment: 1 }
        }
      });

      return user.id;
    });
    const fresh = await this.getSession(session);
    if (!fresh) throw new NotFoundError("Session not found after save");
    return fresh;
  }

  async saveResult(sessionId: string, result: HealthEvaluation): Promise<SessionRecord> {
    await this.db.$transaction(async (tx: any) => {
      const user = await tx.user.findUnique({
        where: { id: sessionId },
        include: { assessment: true }
      });
      if (!user || !user.assessment) throw new NotFoundError("Session not found");

      await tx.healthResult.upsert({
        where: { assessmentId: user.assessment.id },
        create: {
          assessmentId: user.assessment.id,
          bmi: result.bmi,
          bmiCategory: result.bmiCategory,
          dailyCalories: result.dailyCalories,
          targetDate: new Date(result.targetDate),
          weeksToTarget: result.weeksToTarget,
          predictionCurve: result.predictionCurve as never
        },
        update: {
          bmi: result.bmi,
          bmiCategory: result.bmiCategory,
          dailyCalories: result.dailyCalories,
          targetDate: new Date(result.targetDate),
          weeksToTarget: result.weeksToTarget,
          predictionCurve: result.predictionCurve as never
        }
      });

      await tx.assessment.update({
        where: { id: user.assessment.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          version: { increment: 1 }
        }
      });
    });

    const fresh = await this.getSession(sessionId);
    if (!fresh) throw new NotFoundError("Session not found after result save");
    return fresh;
  }

  async activateSubscription(input: PaymentActivationInput): Promise<PaymentActivationResult> {
    const existing = await this.db.paymentEvent.findUnique({
      where: { providerEventId: input.providerEventId }
    });
    if (existing) {
      await this.markActive(input.sessionId);
      return { subscriptionStatus: "ACTIVE", idempotent: true };
    }

    await this.db.$transaction(async (tx: any) => {
      const user = await tx.user.findUnique({ where: { id: input.sessionId } });
      if (!user) throw new NotFoundError("Session not found");

      await tx.paymentEvent.create({
        data: {
          userId: input.sessionId,
          providerEventId: input.providerEventId,
          eventType: "mock.payment_succeeded",
          rawPayload: input.rawPayload as never
        }
      });

      await tx.user.update({
        where: { id: input.sessionId },
        data: { subscriptionStatus: "ACTIVE" }
      });

      await tx.subscription.upsert({
        where: { userId: input.sessionId },
        create: {
          userId: input.sessionId,
          status: "ACTIVE",
          activatedAt: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        },
        update: {
          status: "ACTIVE",
          activatedAt: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });
    });

    return { subscriptionStatus: "ACTIVE", idempotent: false };
  }

  private async markActive(sessionId: string): Promise<void> {
    const user = await this.db.user.findUnique({ where: { id: sessionId } });
    if (!user) throw new NotFoundError("Session not found");
    await this.db.user.update({
      where: { id: sessionId },
      data: { subscriptionStatus: "ACTIVE" }
    });
    await this.db.subscription.upsert({
      where: { userId: sessionId },
      create: { userId: sessionId, status: "ACTIVE", activatedAt: new Date() },
      update: { status: "ACTIVE", activatedAt: new Date() }
    });
  }
}
