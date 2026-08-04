import net from "node:net";

const bindAddress = process.env.CORAL_INGRESS_BIND_ADDRESS?.trim() || "0.0.0.0";
const host = bindAddress === "0.0.0.0"
  ? "127.0.0.1"
  : bindAddress === "::"
    ? "::1"
    : bindAddress;
const port = Number(process.env.CORAL_INGRESS_PORT || 3_000);

const socket = net.connect({ host, port });
const timer = setTimeout(() => socket.destroy(new Error("Ingress health check timed out.")), 4_000);

socket.once("connect", () => {
  clearTimeout(timer);
  socket.end();
});
socket.once("error", () => {
  clearTimeout(timer);
  process.exit(1);
});
