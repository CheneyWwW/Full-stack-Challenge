import { NextResponse } from "next/server";
import { ValidationProblem } from "@/src/domain/validation";
import { ConflictError, NotFoundError } from "./errors";
import { MemoryAssessmentStore } from "./memory-store";
import { PrismaAssessmentStore } from "./prisma-store";
import { prisma } from "./prisma";
import { AssessmentStore } from "./store";

const globalForStore = globalThis as unknown as {
  assessmentStore?: AssessmentStore;
};

function shouldUseMemoryStore() {
  if (process.env.APP_STORE === "memory") return true;
  if (process.env.APP_STORE === "prisma") return false;
  return process.env.NODE_ENV !== "production" && !process.env.DATABASE_URL;
}

function createStore(): AssessmentStore {
  if (shouldUseMemoryStore()) {
    console.warn("Using in-memory assessment store. Set DATABASE_URL to use Prisma/PostgreSQL.");
    return new MemoryAssessmentStore();
  }
  return new PrismaAssessmentStore(prisma);
}

export const store = globalForStore.assessmentStore ?? createStore();

if (process.env.NODE_ENV !== "production") globalForStore.assessmentStore = store;

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function toErrorResponse(error: unknown) {
  if (error instanceof ValidationProblem) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: error.message,
          details: error.issues
        }
      },
      { status: 400 }
    );
  }

  if (error instanceof NotFoundError) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: error.message } },
      { status: 404 }
    );
  }

  if (error instanceof ConflictError) {
    return NextResponse.json(
      { error: { code: "CONFLICT", message: error.message } },
      { status: 409 }
    );
  }

  console.error(error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } },
    { status: 500 }
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
