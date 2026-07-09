import { getProgress } from "@/src/server/workflows";
import { ok, store, toErrorResponse } from "@/src/server/http";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await context.params;
    return ok(await getProgress(store, sessionId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
