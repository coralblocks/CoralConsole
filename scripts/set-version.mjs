import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const version = process.argv[2]?.trim();

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: npm run version:set -- A.B.C");
  console.error("Example: npm run version:set -- 1.3.2");
  process.exit(1);
}

const projectDirectory = resolve(import.meta.dirname, "..");
const packagePath = resolve(projectDirectory, "package.json");
const lockPath = resolve(projectDirectory, "package-lock.json");
const packageMetadata = JSON.parse(await readFile(packagePath, "utf8"));
const packageLock = JSON.parse(await readFile(lockPath, "utf8"));

packageMetadata.version = version;
packageLock.version = version;
packageLock.packages[""].version = version;

await Promise.all([
  writeFile(packagePath, `${JSON.stringify(packageMetadata, null, 2)}\n`),
  writeFile(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`),
]);

console.log(`CoralConsole version set to ${version}.`);
