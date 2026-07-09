import { createSession } from "@/src/server/workflows";
import { ok, store, toErrorResponse } from "@/src/server/http";

export async function POST() {
  try {
    return ok(await createSession(store), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
