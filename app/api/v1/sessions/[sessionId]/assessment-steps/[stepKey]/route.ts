import { BadRequestError } from "@/src/server/errors";
import { ok, readJson, store, toErrorResponse } from "@/src/server/http";
import { isStepKey, saveAssessmentStep } from "@/src/server/workflows";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ sessionId: string; stepKey: string }> }
) {
  try {
    const { sessionId, stepKey } = await context.params;
    const normalizedStepKey = stepKey.toUpperCase();
    if (!isStepKey(normalizedStepKey)) {
      throw new BadRequestError(`Unknown assessment step: ${stepKey}`);
    }
    return ok(await saveAssessmentStep(store, sessionId, normalizedStepKey, await readJson(request)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
