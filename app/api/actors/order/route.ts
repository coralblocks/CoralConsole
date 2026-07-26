import { apiErrorResponse, apiJson, ApiError, mutationAllowed, readJson } from "@/lib/http";
import { listActors, reorderActors } from "@/lib/repository";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    if (!mutationAllowed(request)) throw new ApiError("Cross-origin requests are not allowed.", 403);
    const input = await readJson<{ actorIds?: unknown }>(request);
    if (!Array.isArray(input.actorIds) || input.actorIds.some((id) => typeof id !== "string")) {
      throw new ApiError("Actor order must be a list of actor IDs.");
    }
    const actorIds = input.actorIds as string[];
    const existingIds = listActors().map((actor) => actor.id);
    if (
      actorIds.length !== existingIds.length
      || new Set(actorIds).size !== actorIds.length
      || actorIds.some((id) => !existingIds.includes(id))
    ) {
      throw new ApiError("Actor order must contain every current actor exactly once.");
    }
    return apiJson({ actors: reorderActors(actorIds) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
