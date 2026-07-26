import { apiErrorResponse, apiJson, ApiError, mutationAllowed, readJson } from "@/lib/http";
import { listActors, reorderActors } from "@/lib/repository";
import type { ActorKind } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    if (!mutationAllowed(request)) throw new ApiError("Cross-origin requests are not allowed.", 403);
    const input = await readJson<{ kind?: unknown; actorIds?: unknown }>(request);
    if (typeof input.kind !== "string") {
      throw new ApiError("Actor type is required when saving actor order.");
    }
    if (!Array.isArray(input.actorIds) || input.actorIds.some((id) => typeof id !== "string")) {
      throw new ApiError("Actor order must be a list of actor IDs.");
    }
    const kind = input.kind as ActorKind;
    const actorIds = input.actorIds as string[];
    const existingIds = listActors().filter((actor) => actor.kind === kind).map((actor) => actor.id);
    if (
      existingIds.length === 0
      || actorIds.length !== existingIds.length
      || new Set(actorIds).size !== actorIds.length
      || actorIds.some((id) => !existingIds.includes(id))
    ) {
      throw new ApiError("Actor order must contain every current actor of that type exactly once.");
    }
    return apiJson({ actors: reorderActors(kind, actorIds) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
