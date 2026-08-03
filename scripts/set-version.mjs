import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const projectDirectory = resolve(import.meta.dirname, "..");
const packagePath = resolve(projectDirectory, "package.json");
const lockPath = resolve(projectDirectory, "package-lock.json");
const packageMetadata = JSON.parse(await readFile(packagePath, "utf8"));
const packageLock = JSON.parse(await readFile(lockPath, "utf8"));
const currentVersion = packageMetadata.version;

if (!VERSION_PATTERN.test(currentVersion)) {
  console.error("package.json does not contain a valid current A.B.C version.");
  process.exit(1);
}

function versionParts(version) {
  return version.split(".").map(Number);
}

function nextVersions(version) {
  const [major, minor, patch] = versionParts(version);
  return {
    patch: `${major}.${minor}.${patch + 1}`,
    minor: `${major}.${minor + 1}.0`,
    major: `${major + 1}.0.0`,
  };
}

function versionIsGreater(candidate, current) {
  const candidateParts = versionParts(candidate);
  const currentParts = versionParts(current);
  for (let index = 0; index < 3; index += 1) {
    if (candidateParts[index] > currentParts[index]) return true;
    if (candidateParts[index] < currentParts[index]) return false;
  }
  return false;
}

function validateNextVersion(version) {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error("Version must use A.B.C format, for example 1.4.0.");
  }
  if (!versionIsGreater(version, currentVersion)) {
    throw new Error(`The next version must be greater than the current version ${currentVersion}.`);
  }
  return version;
}

async function readPipedAnswers() {
  let source = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) source += chunk;
  if (!source) throw new Error("Version selection was cancelled.");
  return source.split(/\r?\n/);
}

async function chooseVersion({ selectionOnly = false } = {}) {
  const suggestions = nextVersions(currentVersion);
  const menu = [
    `Current CoralConsole version: ${currentVersion}`,
    "Choose the next version:",
    `  1) ${suggestions.patch}  patch (recommended)`,
    `  2) ${suggestions.minor}  minor`,
    `  3) ${suggestions.major}  major`,
    "  4) Enter a custom A.B.C version",
  ].join("\n");
  const promptOutput = selectionOnly ? process.stderr : process.stdout;
  promptOutput.write(`${menu}\n`);

  let selection;
  let customVersion;
  if (process.stdin.isTTY) {
    const terminal = createInterface({ input: process.stdin, output: promptOutput });
    try {
      selection = (await terminal.question("Selection [1]: ")).trim();
      if (selection === "4" || selection.toLowerCase() === "custom") {
        customVersion = (await terminal.question("Custom version: ")).trim();
      }
    } finally {
      terminal.close();
    }
  } else {
    promptOutput.write("Selection [1]: ");
    const answers = await readPipedAnswers();
    selection = (answers.shift() || "").trim();
    if (selection === "4" || selection.toLowerCase() === "custom") {
      customVersion = (answers.shift() || "").trim();
      promptOutput.write("Custom version: \n");
    } else {
      promptOutput.write("\n");
    }
  }

  if (!selection || selection === "1" || selection.toLowerCase() === "patch") return suggestions.patch;
  if (selection === "2" || selection.toLowerCase() === "minor") return suggestions.minor;
  if (selection === "3" || selection.toLowerCase() === "major") return suggestions.major;
  if (selection === "4" || selection.toLowerCase() === "custom") return validateNextVersion(customVersion);
  if (VERSION_PATTERN.test(selection)) return validateNextVersion(selection);
  throw new Error(`Unknown selection "${selection}".`);
}

let version;
try {
  const selectionOnly = process.argv[2] === "--select-only";
  const requestedVersion = process.argv[selectionOnly ? 3 : 2]?.trim();
  if (requestedVersion === "--help" || requestedVersion === "-h") {
    console.log("Usage: npm run version:set -- [A.B.C]");
    console.log("Omit A.B.C to choose an interactive patch, minor, major, or custom version.");
    process.exit(0);
  }
  version = requestedVersion ? validateNextVersion(requestedVersion) : await chooseVersion({ selectionOnly });
  if (selectionOnly) {
    process.stdout.write(`${version}\n`);
    process.exit(0);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Version selection failed.");
  process.exit(1);
}

packageMetadata.version = version;
packageLock.version = version;
packageLock.packages[""].version = version;

await Promise.all([
  writeFile(packagePath, `${JSON.stringify(packageMetadata, null, 2)}\n`),
  writeFile(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`),
]);

console.log(`CoralConsole version set to ${version}.`);
