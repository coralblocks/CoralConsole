import { apiErrorResponse, apiJson } from "@/lib/http";
import { listAudit, purgeExpiredAudit } from "@/lib/repository";
import { AUDIT_OUTCOMES } from "@/lib/types";

export const runtime = "nodejs";

export function GET(request: Request) {
  try {
    purgeExpiredAudit();
    const url = new URL(request.url);
    const outcome = url.searchParams.get("outcome");
    const selectedOutcome = AUDIT_OUTCOMES.find((value) => value === outcome);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
    return apiJson({ entries: listAudit({
      actorId: url.searchParams.get("actorId") || undefined,
      query: url.searchParams.get("query")?.trim() || undefined,
      outcome: selectedOutcome,
      limit,
    }) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
