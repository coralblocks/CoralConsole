#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants, createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const supportedArchitectures = new Set(["amd64", "arm64"]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim();
    throw new Error(detail || `${command} exited with status ${result.status}.`);
  }
  return result.stdout?.trim() || "";
}

function requireTool(command, args = ["--version"]) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: "ignore" });
  if (result.error?.code === "ENOENT") {
    throw new Error(`Required release tool '${command}' is not installed or is not on PATH.`);
  }
  if (result.error) throw result.error;
}

function normalizeArchitecture(value) {
  if (value === "x86_64") return "amd64";
  if (value === "aarch64") return "arm64";
  return value;
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function walk(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    paths.push(relativePath);
    if (entry.isDirectory()) paths.push(...await walk(join(directory, entry.name), relativePath));
  }
  return paths;
}

async function verifyArchive(archivePath, releaseDirectoryName, architecture, releaseImage) {
  const extractionRoot = await mkdtemp(join(tmpdir(), "coralconsole-release-verify-"));
  try {
    run("tar", ["-xzf", archivePath, "-C", extractionRoot]);
    const releaseRoot = join(extractionRoot, releaseDirectoryName);
    const requiredPaths = [
      ".coralconsole/release-image.tar",
      ".coralconsole/image-name",
      ".coralconsole/image-architecture",
      "install.sh",
      "Dockerfile",
      "Dockerfile.dev",
      "docker-compose.yml",
      "docker-compose.dev.yml",
      "package.json",
      "package-lock.json",
      "README.md",
      "DEPLOYMENT.md",
      "AGENTS.md",
      "LICENSE",
      "scripts/docker-start.sh",
      "scripts/docker-stop.sh",
      "scripts/docker-release.sh",
      "scripts/docker-dev-start.sh",
      "scripts/docker-dev-stop.sh",
      "scripts/docker-dev-rebuild.sh",
      "scripts/docker-backup.sh",
      "scripts/docker-common.sh",
      "scripts/docker-command.sh",
      "scripts/build-site.sh",
      "scripts/docker-restart.sh",
      "scripts/docker-status.sh",
      "scripts/docker-logs.sh",
      "scripts/docker-dev-logs.sh",
      "scripts/actors-export.sh",
      "scripts/actors-import.sh",
      "scripts/migrate.mjs",
      "scripts/package-release.mjs",
      "drizzle/meta/_journal.json",
    ];
    for (const relativePath of requiredPaths) {
      await access(join(releaseRoot, relativePath), constants.R_OK).catch(() => {
        throw new Error(`Release archive is missing required path: ${relativePath}`);
      });
    }

    const imageMetadata = await stat(join(releaseRoot, ".coralconsole/release-image.tar"));
    if (imageMetadata.size === 0) throw new Error("Release archive contains an empty Docker image.");
    if ((await readFile(join(releaseRoot, ".coralconsole/image-name"), "utf8")).trim() !== releaseImage) {
      throw new Error("Release archive contains incorrect Docker image metadata.");
    }
    if ((await readFile(join(releaseRoot, ".coralconsole/image-architecture"), "utf8")).trim() !== architecture) {
      throw new Error("Release archive contains incorrect architecture metadata.");
    }

    const executablePaths = [
      "install.sh",
      "scripts/docker-start.sh",
      "scripts/docker-stop.sh",
      "scripts/docker-release.sh",
      "scripts/docker-dev-start.sh",
      "scripts/docker-dev-stop.sh",
      "scripts/docker-dev-rebuild.sh",
      "scripts/docker-backup.sh",
      "scripts/build-site.sh",
      "scripts/docker-restart.sh",
      "scripts/docker-status.sh",
      "scripts/docker-logs.sh",
      "scripts/docker-dev-logs.sh",
      "scripts/actors-export.sh",
      "scripts/actors-import.sh",
    ];
    for (const relativePath of executablePaths) {
      const metadata = await stat(join(releaseRoot, relativePath));
      if ((metadata.mode & 0o111) === 0) {
        throw new Error(`Release archive did not preserve executable mode for ${relativePath}`);
      }
    }

    const archivedPaths = await walk(releaseRoot);
    const forbiddenPath = archivedPaths.find((relativePath) =>
      relativePath === ".env" ||
      relativePath === ".git" || relativePath.startsWith(".git/") ||
      relativePath === "node_modules" || relativePath.startsWith("node_modules/") ||
      relativePath === ".next" || relativePath.startsWith(".next/") ||
      relativePath === "backups" || relativePath.startsWith("backups/") ||
      /(?:^|\/)[^/]+\.(?:db|db-wal|db-shm|sqlite|sqlite3)$/.test(relativePath)
    );
    if (forbiddenPath) throw new Error(`Release archive contains forbidden local state: ${forbiddenPath}`);
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

function usage() {
  process.stdout.write("Usage: npm run release:package -- [amd64|arm64]\n");
  process.stdout.write("Omit the architecture to package for the Docker Engine's native architecture.\n");
}

let archivePath;
let checksumPath;
let stagingRoot;
let removeArchiveOnFailure = false;
let removeChecksumOnFailure = false;

try {
  const requestedArgument = process.argv[2];
  if (requestedArgument === "--help" || requestedArgument === "-h") {
    usage();
    process.exit(0);
  }
  if (process.argv.length > 3) throw new Error("Pass at most one target architecture.");

  requireTool("git");
  requireTool("tar");
  requireTool("docker", ["version"]);

  const packageMetadata = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  const packageLock = JSON.parse(await readFile(join(projectRoot, "package-lock.json"), "utf8"));
  const version = packageMetadata.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("package.json must contain a semantic A.B.C version before packaging a release.");
  }
  if (packageLock.version !== version || packageLock.packages?.[""]?.version !== version) {
    throw new Error("package.json and package-lock.json versions do not match.");
  }

  const branch = run("git", ["branch", "--show-current"]);
  if (branch && branch !== "main") throw new Error(`Release packages must be created from main, not ${branch}.`);
  if (run("git", ["status", "--porcelain", "--untracked-files=all"])) {
    throw new Error("Release packages require a clean Git worktree, including no untracked files.");
  }

  const tag = `v${version}`;
  const headCommit = run("git", ["rev-parse", "HEAD"]);
  let tagCommit;
  try {
    tagCommit = run("git", ["rev-parse", `${tag}^{commit}`]);
  } catch {
    throw new Error(`Required release tag ${tag} does not exist.`);
  }
  if (tagCommit !== headCommit) throw new Error(`Release tag ${tag} does not point to HEAD.`);

  const enginePlatform = run("docker", ["info", "--format", "{{.OSType}}/{{.Architecture}}"]);
  const [engineOs, engineArchitectureValue] = enginePlatform.split("/");
  if (engineOs !== "linux") throw new Error("Release images must be built with a Docker Engine running Linux containers.");
  const engineArchitecture = normalizeArchitecture(engineArchitectureValue);
  const architecture = normalizeArchitecture(requestedArgument || engineArchitecture);
  if (!supportedArchitectures.has(architecture)) {
    throw new Error(`Unsupported release architecture '${architecture}'. Choose amd64 or arm64.`);
  }
  if (architecture !== engineArchitecture) {
    throw new Error(`Cross-architecture release builds are not supported. Use a native Linux ${architecture} Docker Engine or the GitHub Release Packages workflow.`);
  }

  const outputDirectory = join(projectRoot, "dist", "releases");
  const releaseDirectoryName = `coralconsole-${version}`;
  const archiveName = `${releaseDirectoryName}-linux-${architecture}.tar.gz`;
  archivePath = join(outputDirectory, archiveName);
  checksumPath = `${archivePath}.sha256`;
  await mkdir(outputDirectory, { recursive: true });

  for (const outputPath of [archivePath, checksumPath]) {
    await access(outputPath).then(() => {
      throw new Error(`Refusing to overwrite existing release output: ${outputPath}`);
    }).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }

  const releaseImage = `coralconsole-release:${version}-linux-${architecture}`;
  process.stdout.write(`Building ${releaseImage} from the tagged source...\n`);
  run("docker", [
    "build",
    "--network", "host",
    "--platform", `linux/${architecture}`,
    "--tag", releaseImage,
    ".",
  ], { stdio: "inherit" });
  const builtPlatform = run("docker", ["image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", releaseImage]);
  if (builtPlatform !== `linux/${architecture}`) {
    throw new Error(`Docker built ${builtPlatform || "an unknown platform"}, expected linux/${architecture}.`);
  }

  stagingRoot = await mkdtemp(join(tmpdir(), "coralconsole-release-build-"));
  const sourceArchive = join(stagingRoot, "source.tar");
  run("git", [
    "archive",
    "--format=tar",
    `--prefix=${releaseDirectoryName}/`,
    `--output=${sourceArchive}`,
    tag,
  ]);
  run("tar", ["-xf", sourceArchive, "-C", stagingRoot]);
  await rm(sourceArchive, { force: true });

  const bundleDirectory = join(stagingRoot, releaseDirectoryName, ".coralconsole");
  await mkdir(bundleDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(bundleDirectory, "image-name"), `${releaseImage}\n`, { mode: 0o644 }),
    writeFile(join(bundleDirectory, "image-architecture"), `${architecture}\n`, { mode: 0o644 }),
  ]);
  process.stdout.write("Embedding the prebuilt image in the release package...\n");
  run("docker", ["save", "--output", join(bundleDirectory, "release-image.tar"), releaseImage], { stdio: "inherit" });

  removeArchiveOnFailure = true;
  run("tar", ["-czf", archivePath, "-C", stagingRoot, releaseDirectoryName]);
  await verifyArchive(archivePath, releaseDirectoryName, architecture, releaseImage);

  const checksum = await sha256(archivePath);
  removeChecksumOnFailure = true;
  await writeFile(checksumPath, `${checksum}  ${basename(archivePath)}\n`, { encoding: "utf8", flag: "wx", mode: 0o644 });
  await chmod(archivePath, 0o644);

  process.stdout.write(`Created ${archivePath}\n`);
  process.stdout.write(`Created ${checksumPath}\n`);
  process.stdout.write("Upload both files to the matching GitHub Release. No Docker registry was used.\n");
} catch (error) {
  if (removeArchiveOnFailure && archivePath) await rm(archivePath, { force: true });
  if (removeChecksumOnFailure && checksumPath) await rm(checksumPath, { force: true });
  process.stderr.write(`${error instanceof Error ? error.message : "Release packaging failed."}\n`);
  process.exitCode = 1;
} finally {
  if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true });
}
