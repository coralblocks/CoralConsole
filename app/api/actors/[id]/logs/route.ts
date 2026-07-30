import { getActorLogs } from "@/lib/actor-logs";
import { apiErrorResponse, apiJson, ApiError } from "@/lib/http";
import { getActor } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!getActor(id)) throw new ApiError("Actor not found.", 404);
    return apiJson({ logs: getActorLogs(id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
