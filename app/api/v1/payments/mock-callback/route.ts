import { activateSubscription } from "@/src/server/workflows";
import { ok, readJson, store, toErrorResponse } from "@/src/server/http";

export async function POST(request: Request) {
  try {
    return ok(await activateSubscription(store, await readJson(request)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
