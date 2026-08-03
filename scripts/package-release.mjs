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
  return result.stdout.trim();
}

function requireTool(command, args = ["--version"]) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: "ignore" });
  if (result.error?.code === "ENOENT") {
    throw new Error(`Required release tool '${command}' is not installed or is not on PATH.`);
  }
  if (result.error) throw result.error;
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

async function verifyArchive(archivePath, releaseDirectoryName) {
  const extractionRoot = await mkdtemp(join(tmpdir(), "coralconsole-release-"));
  try {
    run("tar", ["-xzf", archivePath, "-C", extractionRoot]);
    const releaseRoot = join(extractionRoot, releaseDirectoryName);
    const requiredPaths = [
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
      "scripts/docker-dev-start.sh",
      "scripts/docker-dev-stop.sh",
      "scripts/docker-common.sh",
      "scripts/docker-command.sh",
      "scripts/migrate.mjs",
      "scripts/package-release.mjs",
      "drizzle/meta/_journal.json",
    ];
    for (const relativePath of requiredPaths) {
      await access(join(releaseRoot, relativePath), constants.R_OK).catch(() => {
        throw new Error(`Release archive is missing required path: ${relativePath}`);
      });
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

let archivePath;
let checksumPath;
let removeArchiveOnFailure = false;
let removeChecksumOnFailure = false;

try {
  requireTool("git");
  requireTool("tar");

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
  if (branch !== "main") throw new Error(`Release packages must be created from main, not ${branch || "a detached HEAD"}.`);
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

  const outputDirectory = join(projectRoot, "dist", "releases");
  const releaseDirectoryName = `coralconsole-${version}`;
  const archiveName = `${releaseDirectoryName}.tar.gz`;
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

  removeArchiveOnFailure = true;
  run("git", [
    "archive",
    "--format=tar.gz",
    `--prefix=${releaseDirectoryName}/`,
    `--output=${archivePath}`,
    tag,
  ]);
  await verifyArchive(archivePath, releaseDirectoryName);

  const checksum = await sha256(archivePath);
  removeChecksumOnFailure = true;
  await writeFile(checksumPath, `${checksum}  ${basename(archivePath)}\n`, { encoding: "utf8", flag: "wx", mode: 0o644 });
  await chmod(archivePath, 0o644);

  process.stdout.write(`Created ${archivePath}\n`);
  process.stdout.write(`Created ${checksumPath}\n`);
} catch (error) {
  if (removeArchiveOnFailure && archivePath) await rm(archivePath, { force: true });
  if (removeChecksumOnFailure && checksumPath) await rm(checksumPath, { force: true });
  process.stderr.write(`${error instanceof Error ? error.message : "Release packaging failed."}\n`);
  process.exitCode = 1;
}
