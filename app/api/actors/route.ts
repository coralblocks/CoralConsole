import { discoverActors, listActorAccounts } from "@/lib/actor-server";
import { apiErrorResponse, apiJson, ApiError, mutationAllowed, readJson } from "@/lib/http";
import { ensureActorScheduler } from "@/lib/refresh";
import { createActors, getActorByIdentity, listActors } from "@/lib/repository";

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
    const actorAccounts = await listActorAccounts(host, port);
    const duplicateAccounts = actorAccounts.filter((account) => getActorByIdentity(host, port, account));
    const newAccounts = actorAccounts.filter((account) => !duplicateAccounts.includes(account));
    if (!newAccounts.length) {
      throw new ApiError("Every actor account at that REST endpoint already exists.", 409);
    }
    const newActors = await discoverActors(host, port, newAccounts);
    try {
      return apiJson({ actors: createActors(newActors), duplicateAccounts }, 201);
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
