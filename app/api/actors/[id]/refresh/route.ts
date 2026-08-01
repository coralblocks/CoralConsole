import { apiErrorResponse, apiJson, ApiError, mutationAllowed } from "@/lib/http";
import { getActor } from "@/lib/repository";
import { refreshActorNow } from "@/lib/refresh";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!mutationAllowed(request)) throw new ApiError("Cross-origin requests are not allowed.", 403);
    const { id } = await params;
    if (!getActor(id)) throw new ApiError("Actor not found.", 404);
    const actor = await refreshActorNow(id, { refreshActions: true });
    if (!actor) throw new ApiError("Actor not found.", 404);
    return apiJson({ actor, refreshedAt: new Date().toISOString() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
