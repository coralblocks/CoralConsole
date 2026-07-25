import { apiErrorResponse, apiJson, ApiError, mutationAllowed, readJson } from "@/lib/http";
import { ensureActorScheduler } from "@/lib/refresh";
import { getSettings } from "@/lib/repository";
import { reportViewerPresence, viewerHeartbeatIntervalSeconds } from "@/lib/viewer-presence";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!mutationAllowed(request)) throw new ApiError("Cross-origin requests are not allowed.", 403);
    const input = await readJson<{ viewerId?: string; active?: boolean }>(request);
    const viewerId = input.viewerId?.trim() || "";
    const active = input.active ?? true;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(viewerId)) throw new ApiError("Viewer presence ID is invalid.");
    if (typeof active !== "boolean") throw new ApiError("Viewer presence state is invalid.");

    const activeViewers = reportViewerPresence(viewerId, active);
    const settings = getSettings();
    ensureActorScheduler();
    return apiJson({
      activeViewers,
      heartbeatIntervalSeconds: viewerHeartbeatIntervalSeconds(settings.viewerGracePeriodSeconds),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
