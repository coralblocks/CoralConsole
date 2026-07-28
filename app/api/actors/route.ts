import { discoverActor } from "@/lib/actor-server";
import { apiErrorResponse, apiJson, ApiError, mutationAllowed, readJson } from "@/lib/http";
import { ensureActorScheduler } from "@/lib/refresh";
import { createActor, getActorByEndpoint, listActors } from "@/lib/repository";

export const runtime = "nodejs";

export function GET() {
  try {
    ensureActorScheduler();
    return apiJson({ actors: listActors() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!mutationAllowed(request)) throw new ApiError("Cross-origin requests are not allowed.", 403);
    const input = await readJson<{ host?: string; port?: number }>(request);
    const host = input.host?.trim();
    const port = Number(input.port);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new ApiError("Enter a host and a valid REST admin port.");
    if (getActorByEndpoint(host, port)) throw new ApiError("That actor endpoint already exists.", 409);
    const actor = await discoverActor(host, port);
    try {
      return apiJson({ actor: createActor(actor) }, 201);
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) throw new ApiError("That actor endpoint already exists.", 409);
      throw error;
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
