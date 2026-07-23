import { apiErrorResponse, apiJson, ApiError, mutationAllowed } from "@/lib/http";
import { clearAudit, listAudit, purgeExpiredAudit } from "@/lib/repository";

export const runtime = "nodejs";

export function GET(request: Request) {
  try {
    purgeExpiredAudit();
    const url = new URL(request.url);
    const outcome = url.searchParams.get("outcome");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
    return apiJson({ entries: listAudit({
      actorId: url.searchParams.get("actorId") || undefined,
      query: url.searchParams.get("query")?.trim() || undefined,
      outcome: outcome === "success" || outcome === "failure" ? outcome : undefined,
      limit,
    }) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export function DELETE(request: Request) {
  try {
    if (!mutationAllowed(request)) throw new ApiError("Cross-origin requests are not allowed.", 403);
    return apiJson({ removed: clearAudit() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
