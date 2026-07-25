import { getSqlite } from "@/db";
import { apiErrorResponse, apiJson } from "@/lib/http";
import { ensureActorScheduler } from "@/lib/refresh";

export const runtime = "nodejs";

export function GET() {
  try {
    getSqlite().prepare("SELECT 1").get();
    ensureActorScheduler();
    return apiJson({ status: "ok", timestamp: new Date().toISOString() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
