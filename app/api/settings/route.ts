import { apiErrorResponse, apiJson, ApiError, mutationAllowed, readJson } from "@/lib/http";
import { getSettings, saveSettings } from "@/lib/repository";
import type { TopologySettings } from "@/lib/types";

export const runtime = "nodejs";

export function GET() {
  try {
    return apiJson({ settings: getSettings() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    if (!mutationAllowed(request)) throw new ApiError("Cross-origin requests are not allowed.", 403);
    const current = getSettings();
    const input = await readJson<Partial<TopologySettings>>(request);
    const topologyName = (input.topologyName ?? current.topologyName).trim();
    const backgroundColor = input.backgroundColor ?? current.backgroundColor;
    const pollIntervalSeconds = Number(input.pollIntervalSeconds ?? current.pollIntervalSeconds);
    const auditRetentionDays = Number(input.auditRetentionDays ?? current.auditRetentionDays);
    if (!topologyName || topologyName.length > 80) throw new ApiError("Topology name must contain 1 to 80 characters.");
    if (!/^#[0-9a-f]{6}$/i.test(backgroundColor)) throw new ApiError("Background color must use #RRGGBB format.");
    if (!Number.isInteger(pollIntervalSeconds) || pollIntervalSeconds < 10 || pollIntervalSeconds > 300) throw new ApiError("Refresh interval must be between 10 and 300 seconds.");
    if (!Number.isInteger(auditRetentionDays) || auditRetentionDays < 1 || auditRetentionDays > 3650) throw new ApiError("Audit retention must be between 1 and 3650 days.");
    return apiJson({ settings: saveSettings({
      topologyName,
      backgroundColor,
      pollIntervalSeconds,
      auditRetentionDays,
      setupComplete: input.setupComplete ?? current.setupComplete,
    }) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
