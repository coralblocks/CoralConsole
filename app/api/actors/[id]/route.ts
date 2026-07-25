import { closeActorStatusConnection } from "@/lib/actor-server";
import { apiErrorResponse, apiJson, ApiError, mutationAllowed } from "@/lib/http";
import { deleteActor, getActor } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = getActor(id);
    if (!actor) throw new ApiError("Actor not found.", 404);
    return apiJson({ actor });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!mutationAllowed(request)) throw new ApiError("Cross-origin requests are not allowed.", 403);
    const { id } = await params;
    const actor = getActor(id);
    if (!actor) throw new ApiError("Actor not found.", 404);
    if (actor.demo) throw new ApiError("Sample actors cannot be removed.", 400);
    closeActorStatusConnection(id);
    deleteActor(id);
    return apiJson({ removed: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
