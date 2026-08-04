import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ACCESS_SESSION_COOKIE,
  accessControlEnabled,
  validAccessSession,
} from "@/lib/access-control";
import AccessGate from "./access-gate";

function safeReturnPath(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate?.startsWith("/")) return "/";
  try {
    const base = new URL("http://coralconsole.invalid");
    const resolved = new URL(candidate, base);
    if (resolved.origin !== base.origin) return "/";
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return "/";
  }
}

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const cookieStore = await cookies();
  const returnTo = safeReturnPath((await searchParams).next);
  if (!accessControlEnabled() || validAccessSession(cookieStore.get(ACCESS_SESSION_COOKIE)?.value)) {
    redirect(returnTo);
  }
  return <AccessGate returnTo={returnTo} />;
}
