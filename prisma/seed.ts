import { prisma } from "../src/server/prisma";
import { PrismaAssessmentStore } from "../src/server/prisma-store";
import {
  activateSubscription,
  createSession,
  getProgress,
  saveAssessmentStep,
  submitAssessment
} from "../src/server/workflows";

const store = new PrismaAssessmentStore(prisma);

const demoSteps = [
  ["GENDER", { gender: "female" }],
  ["GOALS", { primaryGoal: "lose_weight", focusAreas: ["belly", "posture"] }],
  ["BODY", { age: 35, heightCm: 165, weightKg: 73, targetWeightKg: 64 }],
  ["ACTIVITY", { activityFrequency: "light" }]
] as const;

async function buildDemo(sessionId: string, paid: boolean) {
  await createSession(store, { sessionId });
  let progress = await getProgress(store, sessionId);
  for (const [stepKey, payload] of demoSteps) {
    progress = await saveAssessmentStep(store, sessionId, stepKey, {
      version: progress.version,
      data: payload
    });
  }
  await submitAssessment(store, sessionId, new Date("2026-07-09T00:00:00.000Z"));
  if (paid) {
    await activateSubscription(store, {
      sessionId,
      idempotencyKey: `seed_${sessionId}`
    });
  }
}

async function main() {
  await prisma.user.deleteMany({
    where: {
      id: {
        in: ["demo_free_session", "demo_paid_session", "demo_pay_session"]
      }
    }
  });

  await buildDemo("demo_free_session", false);
  await buildDemo("demo_paid_session", true);
  await buildDemo("demo_pay_session", false);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
