import { ActorCallError, callActorEndpoint } from "@/lib/actor-server";
import { apiErrorResponse, apiJson, ApiError, clientIp, mutationAllowed, readJson } from "@/lib/http";
import { runCoordinatedAdminAction } from "@/lib/refresh";
import { getActor, purgeExpiredAudit, recordAudit } from "@/lib/repository";
import type { AdminActionReply } from "@/lib/types";

export const runtime = "nodejs";

const MAX_PARAMS = 8 * 1024;
const MAX_OUTPUT = 256 * 1024;

function bounded(value: string) {
  return value.length > MAX_OUTPUT ? { value: value.slice(0, MAX_OUTPUT), truncated: true } : { value, truncated: false };
}

export async function POST(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const started = Date.now();
  let actor = null as ReturnType<typeof getActor>;
  let action = "";
  let scopedAction = "";
  let actionParams = "";
  try {
    if (!mutationAllowed(request)) throw new ApiError("Cross-origin requests are not allowed.", 403);
    const { id } = await routeParams;
    actor = getActor(id);
    if (!actor) throw new ApiError("Actor not found.", 404);
    const input = await readJson<{ action?: string; params?: string }>(request);
    action = input.action?.trim() || "";
    actionParams = input.params || "";
    if (!actor.actions.includes(action)) throw new ApiError("That admin action is not available for this actor.");
    if (actionParams.length > MAX_PARAMS) throw new ApiError("Admin action parameters are too long.");

    scopedAction = action === "list" ? "list" : `${actor.name} ${action}`;
    const actionActor = actor;
    const reply = await runCoordinatedAdminAction<AdminActionReply>(actionActor.id, async () => {
      if (actionActor.demo) {
        return { result: true, adminCommand: scopedAction, params: actionParams, results: `${action} simulated successfully on ${actionActor.name}` };
      }
      return callActorEndpoint(actionActor.host, actionActor.port, scopedAction, actionParams);
    });
    const output = bounded(reply.results || "");
    recordAudit({
      actorId: actor.id,
      actorName: actor.name,
      actorEndpoint: `${actor.host}:${actor.port}`,
      action: scopedAction,
      params: actionParams,
      output: output.value,
      outcome: "success",
      error: null,
      durationMs: Date.now() - started,
      sourceIp: clientIp(request),
      truncated: output.truncated,
    });
    purgeExpiredAudit();
    return apiJson({ ...reply, results: output.value, truncated: output.truncated });
  } catch (error) {
    if (actor && action) {
      const reply = error instanceof ActorCallError ? error.reply : undefined;
      const output = bounded(reply?.results || "");
      recordAudit({
        actorId: actor.id,
        actorName: actor.name,
        actorEndpoint: `${actor.host}:${actor.port}`,
        action: scopedAction || action,
        params: actionParams,
        output: output.value,
        outcome: error instanceof ActorCallError ? error.outcome : "error",
        error: error instanceof Error ? error.message : "Admin action failed.",
        durationMs: Date.now() - started,
        sourceIp: clientIp(request),
        truncated: output.truncated,
      });
    }
    return apiErrorResponse(error);
  }
}
