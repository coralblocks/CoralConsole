import { NextResponse } from "next/server";

export function apiJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new ApiError("The request body must be valid JSON.", 400);
  }
}

export class ApiError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function mutationAllowed(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const expectedHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || requestUrl.host;
    const expectedProtocol = request.headers.get("x-forwarded-proto") || requestUrl.protocol.replace(":", "");
    return originUrl.host === expectedHost && originUrl.protocol === `${expectedProtocol}:`;
  } catch {
    return false;
  }
}

export function clientIp(request: Request) {
  if (process.env.CORAL_TRUST_PROXY !== "true") return null;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || null;
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof ApiError) return apiJson({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  return apiJson({ error: message }, 500);
}
