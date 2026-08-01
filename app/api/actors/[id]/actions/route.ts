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
  let accountAction = "";
  let adminAccount = "";
  let submittedParams = "";
  let requestParams = "";
  try {
    if (!mutationAllowed(request)) throw new ApiError("Cross-origin requests are not allowed.", 403);
    const { id } = await routeParams;
    actor = getActor(id);
    if (!actor) throw new ApiError("Actor not found.", 404);
    const input = await readJson<{ account?: string; action?: string; params?: string }>(request);
    if (input.account !== undefined && typeof input.account !== "string") {
      throw new ApiError("Admin account must be text.");
    }
    action = input.action?.trim() || "";
    adminAccount = input.account?.trim() || actor.account;
    submittedParams = input.params || "";
    if (adminAccount !== actor.account && adminAccount !== "VM") {
      throw new ApiError("That admin account is not available for this actor.");
    }
    const availableActions = adminAccount === "VM" ? actor.vmActions : actor.actions;
    if (!availableActions.includes(action)) throw new ApiError("That admin action is not available for the selected account.");
    if (submittedParams.length > MAX_PARAMS) throw new ApiError("Admin action parameters are too long.");

    accountAction = action === "list" ? "list" : `${adminAccount} ${action}`;
    requestParams = action === "list" ? adminAccount : submittedParams;
    const actionActor = actor;
    const reply = await runCoordinatedAdminAction<AdminActionReply>(actionActor.id, async () => {
      if (actionActor.demo) {
        return { result: true, adminCommand: accountAction, params: requestParams, results: `${action} simulated successfully on ${adminAccount} for ${actionActor.name}` };
      }
      return callActorEndpoint(actionActor.host, actionActor.port, accountAction, requestParams);
    });
    const output = bounded(reply.results || "");
    recordAudit({
      actorId: actor.id,
      actorName: actor.name,
      actorEndpoint: `${actor.host}:${actor.port}`,
      action: accountAction,
      params: requestParams,
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
        action: accountAction || action,
        params: requestParams || submittedParams,
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
