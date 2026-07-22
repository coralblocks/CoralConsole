type ActorRequest = {
  host?: string;
  port?: number;
  adminCommand?: string;
  params?: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  let input: ActorRequest;

  try {
    input = (await request.json()) as ActorRequest;
  } catch {
    return json({ error: "The request body must be valid JSON." }, 400);
  }

  const host = input.host?.trim();
  const port = Number(input.port);
  const adminCommand = input.adminCommand?.trim();

  if (!host || !adminCommand || !Number.isInteger(port) || port < 1 || port > 65535) {
    return json({ error: "Host, port, and adminCommand are required." }, 400);
  }

  let target: URL;
  try {
    target = new URL(/^https?:\/\//i.test(host) ? host : `http://${host}`);
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("Unsupported protocol");
    if (target.username || target.password || (target.pathname !== "/" && target.pathname !== "")) throw new Error("Unexpected URL parts");
    target.port = String(port);
    target.pathname = "/";
    target.search = "";
    target.hash = "";
  } catch {
    return json({ error: "Enter a plain IP address or hostname." }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminCommand, params: input.params || "" }),
      signal: controller.signal,
    });

    const text = await upstream.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return json({ error: `Actor returned a non-JSON response (${upstream.status}).` }, 502);
    }

    if (!upstream.ok) return json(payload, upstream.status);
    return json(payload);
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Actor did not respond within 6.5 seconds."
      : "Could not reach the actor. Check its address, REST port, and network access.";
    return json({ error: message }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
