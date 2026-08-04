import {
  ACCESS_SESSION_COOKIE,
  accessControlEnabled,
  accessCookieIsSecure,
  accessKeyMatches,
  createAccessSessionCookie,
} from "@/lib/access-control";
import { apiErrorResponse, apiJson, ApiError, mutationAllowed, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!accessControlEnabled()) throw new ApiError("Access key protection is not enabled.", 404);
    if (!mutationAllowed(request)) throw new ApiError("Cross-origin requests are not allowed.", 403);

    const input = await readJson<{ accessKey?: unknown }>(request);
    if (typeof input.accessKey !== "string" || input.accessKey.length > 4096) {
      throw new ApiError("Access key is incorrect.", 401);
    }
    const candidate = input.accessKey.trim();
    if (!candidate || !accessKeyMatches(candidate)) {
      throw new ApiError("Access key is incorrect.", 401);
    }

    const response = apiJson({ authenticated: true });
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(ACCESS_SESSION_COOKIE, createAccessSessionCookie(), {
      httpOnly: true,
      sameSite: "strict",
      secure: accessCookieIsSecure(request),
      path: "/",
    });
    return response;
  } catch (error) {
    const response = apiErrorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
