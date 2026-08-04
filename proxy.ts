import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  ACCESS_SESSION_COOKIE,
  accessControlEnabled,
  validAccessSession,
} from "@/lib/access-control";

const PUBLIC_PATHS = new Set([
  "/access",
  "/api/access/login",
  "/api/health",
]);

export function proxy(request: NextRequest) {
  if (!accessControlEnabled() || PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (validAccessSession(request.cookies.get(ACCESS_SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "A valid CoralConsole access session is required." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const gateUrl = request.nextUrl.clone();
  gateUrl.pathname = "/access";
  gateUrl.search = "";
  gateUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.redirect(gateUrl);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|og.png|og-v2.png).*)",
  ],
};
