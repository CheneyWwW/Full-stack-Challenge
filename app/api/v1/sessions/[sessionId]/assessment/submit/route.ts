import { ok, store, toErrorResponse } from "@/src/server/http";
import { submitAssessment } from "@/src/server/workflows";

export async function POST(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await context.params;
    return ok(await submitAssessment(store, sessionId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
