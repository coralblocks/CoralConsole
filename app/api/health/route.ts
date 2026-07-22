import { getSqlite } from "@/db";
import { apiErrorResponse, apiJson } from "@/lib/http";

export const runtime = "nodejs";

export function GET() {
  try {
    getSqlite().prepare("SELECT 1").get();
    return apiJson({ status: "ok", timestamp: new Date().toISOString() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
