const bindAddress = process.env.CORAL_INGRESS_BIND_ADDRESS?.trim() || "0.0.0.0";
const host = bindAddress === "0.0.0.0"
  ? "127.0.0.1"
  : bindAddress === "::"
    ? "[::1]"
    : bindAddress.includes(":")
      ? `[${bindAddress}]`
      : bindAddress;
const port = Number(process.env.CORAL_INGRESS_PORT || 3_000);

fetch(`http://${host}:${port}/api/health`)
  .then((response) => {
    if (!response.ok) process.exit(1);
  })
  .catch(() => process.exit(1));
