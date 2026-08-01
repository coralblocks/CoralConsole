import { apiErrorResponse, apiJson, ApiError, mutationAllowed, readJson } from "@/lib/http";
import { refreshActors } from "@/lib/refresh";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!mutationAllowed(request)) throw new ApiError("Cross-origin requests are not allowed.", 403);
    const input = await readJson<{ force?: boolean; refreshActions?: boolean }>(request);
    return apiJson({
      actors: await refreshActors({
        force: Boolean(input.force),
        refreshActions: Boolean(input.refreshActions),
      }),
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
