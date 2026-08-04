import { createHash } from "node:crypto";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const accessKey = Buffer.concat(chunks).toString("utf8").trim();
if (!accessKey) {
  console.error("An access key is required on standard input.");
  process.exit(1);
}
process.stdout.write(`${createHash("sha256").update(accessKey, "utf8").digest("hex")}\n`);
