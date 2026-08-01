import { actorUrl, closeActorMonitoringConnection } from "@/lib/actor-server";
import { clearActorLogs } from "@/lib/actor-logs";
import { apiErrorResponse, apiJson, ApiError, mutationAllowed, readJson } from "@/lib/http";
import { runExclusiveActorMutation } from "@/lib/refresh";
import { deleteActor, getActor, updateActorEndpoint } from "@/lib/repository";

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

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!mutationAllowed(request)) throw new ApiError("Cross-origin requests are not allowed.", 403);
    const { id } = await params;
    const actor = getActor(id);
    if (!actor) throw new ApiError("Actor not found.", 404);
    if (actor.demo) throw new ApiError("Sample actors cannot be edited.", 400);
    const input = await readJson<{ host?: unknown; port?: unknown }>(request);
    if (input.host === undefined && input.port === undefined) throw new ApiError("Provide a REST host, port, or both.");
    if (input.host !== undefined && typeof input.host !== "string") throw new ApiError("REST host must be text.");
    const host = input.host === undefined ? actor.host : input.host.trim();
    const port = input.port === undefined ? actor.port : Number(input.port);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ApiError("Enter a host and a valid REST admin port.");
    }
    try {
      actorUrl(host, port);
    } catch {
      throw new ApiError("Enter a plain IP address or hostname.");
    }
    try {
      const updated = await runExclusiveActorMutation(id, () => {
        const saved = updateActorEndpoint(id, host, port);
        closeActorMonitoringConnection(id);
        clearActorLogs(id);
        return saved;
      });
      return apiJson({ actor: updated });
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
        throw new ApiError("That actor account at that REST endpoint already exists.", 409);
      }
      throw error;
    }
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
    await runExclusiveActorMutation(id, () => {
      closeActorMonitoringConnection(id);
      clearActorLogs(id);
      deleteActor(id);
    });
    return apiJson({ removed: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
