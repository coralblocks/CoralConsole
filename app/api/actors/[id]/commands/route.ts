import { ActorCallError, callActorEndpoint } from "@/lib/actor-server";
import { apiErrorResponse, apiJson, ApiError, clientIp, mutationAllowed, readJson } from "@/lib/http";
import { getActor, purgeExpiredAudit, recordAudit } from "@/lib/repository";
import type { AdminReply } from "@/lib/types";

export const runtime = "nodejs";

const MAX_PARAMS = 8 * 1024;
const MAX_OUTPUT = 256 * 1024;

function bounded(value: string) {
  return value.length > MAX_OUTPUT ? { value: value.slice(0, MAX_OUTPUT), truncated: true } : { value, truncated: false };
}

export async function POST(request: Request, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const started = Date.now();
  let actor = null as ReturnType<typeof getActor>;
  let command = "";
  let scopedCommand = "";
  let commandParams = "";
  try {
    if (!mutationAllowed(request)) throw new ApiError("Cross-origin requests are not allowed.", 403);
    const { id } = await routeParams;
    actor = getActor(id);
    if (!actor) throw new ApiError("Actor not found.", 404);
    const input = await readJson<{ command?: string; params?: string }>(request);
    command = input.command?.trim() || "";
    commandParams = input.params || "";
    if (!actor.commands.includes(command)) throw new ApiError("That command is not available for this actor.");
    if (commandParams.length > MAX_PARAMS) throw new ApiError("Command parameters are too long.");

    scopedCommand = command === "list" ? "list" : `${actor.name} ${command}`;
    let reply: AdminReply;
    if (actor.demo) {
      reply = { result: true, adminCommand: scopedCommand, params: commandParams, results: `${command} simulated successfully on ${actor.name}` };
    } else {
      reply = await callActorEndpoint(actor.host, actor.port, scopedCommand, commandParams);
    }
    const output = bounded(reply.results || "");
    recordAudit({
      actorId: actor.id,
      actorName: actor.name,
      actorEndpoint: `${actor.host}:${actor.port}`,
      command: scopedCommand,
      params: commandParams,
      output: output.value,
      success: true,
      error: null,
      durationMs: Date.now() - started,
      sourceIp: clientIp(request),
      truncated: output.truncated,
    });
    purgeExpiredAudit();
    return apiJson({ ...reply, results: output.value, truncated: output.truncated });
  } catch (error) {
    if (actor && command) {
      const reply = error instanceof ActorCallError ? error.reply : undefined;
      const output = bounded(reply?.results || "");
      recordAudit({
        actorId: actor.id,
        actorName: actor.name,
        actorEndpoint: `${actor.host}:${actor.port}`,
        command: scopedCommand || command,
        params: commandParams,
        output: output.value,
        success: false,
        error: error instanceof Error ? error.message : "Command failed.",
        durationMs: Date.now() - started,
        sourceIp: clientIp(request),
        truncated: output.truncated,
      });
    }
    return apiErrorResponse(error);
  }
}
