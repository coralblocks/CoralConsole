import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");

async function createFakeDockerBin(root) {
  const binDirectory = join(root, "fake-bin");
  await mkdir(binDirectory, { recursive: true });
  const dockerPath = join(binDirectory, "docker");
  const unamePath = join(binDirectory, "uname");

  await writeFile(unamePath, `#!/bin/sh
case "\${1:-}" in
  -s) echo "\${FAKE_UNAME_SYSTEM:-Linux}" ;;
  -m) echo "\${FAKE_UNAME_MACHINE:-x86_64}" ;;
  *) echo "\${FAKE_UNAME_SYSTEM:-Linux}" ;;
esac
`, { mode: 0o755 });

  await writeFile(dockerPath, `#!/bin/sh
if [ -n "\${FAKE_DOCKER_LOG:-}" ]; then
  printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
fi

case "\${1:-}" in
  info)
    if [ "\${2:-}" = "--format" ]; then echo "linux"; fi
    exit 0
    ;;
  ps)
    case "$*" in
      *com.docker.compose.service=coralconsole-ingress*)
        if [ -n "\${FAKE_RESERVED_PORTS:-}" ]; then echo "reserved-ingress"; fi
        ;;
    esac
    exit 0
    ;;
  volume) exit 0 ;;
  inspect)
    case "$*" in
      *com.docker.compose.project*) echo "another-coralconsole" ;;
      *.Config.Env*)
        old_ifs=$IFS
        IFS=,
        for reserved_port in \${FAKE_RESERVED_PORTS:-}; do
          echo "CORAL_INGRESS_PORT=$reserved_port"
        done
        IFS=$old_ifs
        ;;
    esac
    exit 0
    ;;
  image)
    if [ "\${2:-}" = "inspect" ]; then exit 1; fi
    ;;
  run)
    previous=
    last=
    for argument in "$@"; do
      previous=$last
      last=$argument
    done
    case ",\${FAKE_BUSY_PORTS:-}," in
      *",$last,"*) exit 10 ;;
    esac
    if [ -n "\${FAKE_LATE_BUSY_PORT:-}" ] && [ "$last" = "$FAKE_LATE_BUSY_PORT" ] && [ -f "\${FAKE_DOCKER_STATE:-}" ]; then
      exit 10
    fi
    case ",\${FAKE_UNAVAILABLE_HOSTS:-}," in
      *",$previous,"*) exit 11 ;;
    esac
    exit 0
    ;;
  compose)
    case "\${2:-}" in
      version) echo "Docker Compose version v2.30.0"; exit 0 ;;
      config)
        case "\${3:-}" in
          --images) echo "fake-coralconsole:local" ;;
          --quiet) ;;
        esac
        exit 0
        ;;
      up)
        if [ -n "\${FAKE_LATE_BUSY_PORT:-}" ] && [ ! -f "\${FAKE_DOCKER_STATE:-}" ]; then
          : > "$FAKE_DOCKER_STATE"
          exit 1
        fi
        exit 0
        ;;
      build|ps|stop) exit 0 ;;
      exec) printf '127.0.0.1:3000'; exit 0 ;;
    esac
    ;;
esac

echo "Unexpected fake docker invocation: $*" >&2
exit 1
`, { mode: 0o755 });

  return binDirectory;
}

async function createInstallFolder(path) {
  await mkdir(path, { recursive: true });
  await cp(join(projectRoot, "install.sh"), join(path, "install.sh"));
  await chmod(join(path, "install.sh"), 0o755);
  for (const name of [
    "Dockerfile",
    "Dockerfile.dev",
    "docker-compose.yml",
    "docker-compose.dev.yml",
    "package.json",
    "package-lock.json",
  ]) {
    await writeFile(join(path, name), `${name}\n`);
  }
}

function runInstaller(installDirectory, binDirectory, input, extraEnvironment = {}) {
  const logPath = join(installDirectory, "docker-calls.log");
  const result = spawnSync("/bin/sh", ["./install.sh"], {
    cwd: installDirectory,
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      ...extraEnvironment,
      PATH: `${binDirectory}:${process.env.PATH}`,
      FAKE_DOCKER_LOG: logPath,
    },
  });
  return { ...result, logPath };
}

function parseEnvironment(source) {
  return Object.fromEntries(source
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
}

test("Compose keeps standard and development images private to the generated project", async () => {
  const [compose, developmentCompose, installer, common, packageMetadata] = await Promise.all([
    readFile(join(projectRoot, "docker-compose.yml"), "utf8"),
    readFile(join(projectRoot, "docker-compose.dev.yml"), "utf8"),
    readFile(join(projectRoot, "install.sh"), "utf8"),
    readFile(join(projectRoot, "scripts/docker-common.sh"), "utf8"),
    readFile(join(projectRoot, "package.json"), "utf8"),
  ]);
  assert.match(compose, /image: \$\{COMPOSE_PROJECT_NAME:-coralconsole\}:local/g);
  assert.match(developmentCompose, /image: \$\{COMPOSE_PROJECT_NAME:-coralconsole\}:dev/g);
  assert.match(compose, /org\.coralconsole\.installation/);
  assert.match(installer, /COMPOSE_PROJECT_NAME=\$CORAL_PROJECT_NAME/);
  assert.match(installer, /docker compose build coralconsole/);
  assert.doesNotMatch(installer, /docker compose[^\n]*docker-compose\.dev\.yml[^\n]*build/);
  assert.match(common, /Run \.\/install\.sh first/);
  assert.equal(JSON.parse(packageMetadata).scripts["release:package"], "node scripts/package-release.mjs");
});

test("fresh installation folders receive independent Docker namespaces and available port defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "coralconsole-install-test-"));
  try {
    const binDirectory = await createFakeDockerBin(root);
    const firstDirectory = join(root, "first", "coralconsole");
    const secondDirectory = join(root, "second", "coralconsole");
    await Promise.all([createInstallFolder(firstDirectory), createInstallFolder(secondDirectory)]);

    const first = runInstaller(firstDirectory, binDirectory, "\n\n\n", {
      FAKE_BUSY_PORTS: "3000,39000",
    });
    assert.equal(first.status, 0, first.stderr);
    const second = runInstaller(secondDirectory, binDirectory, "\n\n\n");
    assert.equal(second.status, 0, second.stderr);

    const firstEnvironment = parseEnvironment(await readFile(join(firstDirectory, ".env"), "utf8"));
    const secondEnvironment = parseEnvironment(await readFile(join(secondDirectory, ".env"), "utf8"));
    assert.match(firstEnvironment.COMPOSE_PROJECT_NAME, /^coralconsole-[0-9a-f]{12}$/);
    assert.match(secondEnvironment.COMPOSE_PROJECT_NAME, /^coralconsole-[0-9a-f]{12}$/);
    assert.notEqual(firstEnvironment.COMPOSE_PROJECT_NAME, secondEnvironment.COMPOSE_PROJECT_NAME);
    assert.equal(firstEnvironment.CORAL_PORT, "3001");
    assert.equal(firstEnvironment.CORAL_INTERNAL_PORT, "39001");
    assert.equal(secondEnvironment.CORAL_PORT, "3000");
    assert.equal(secondEnvironment.CORAL_INTERNAL_PORT, "39000");
    assert.equal((await stat(join(firstDirectory, ".env"))).mode & 0o777, 0o600);

    const calls = await readFile(first.logPath, "utf8");
    assert.match(calls, /run --rm --network host node:22-trixie-slim/);
    assert.match(calls, /127\.0\.0\.1 3000/);
    assert.match(calls, /127\.0\.0\.1 3001/);
    assert.match(calls, /compose build coralconsole/);
    assert.match(calls, /compose up -d --no-build --wait coralconsole coralconsole-ingress/);
    assert.match(first.stdout, /standard mode is available/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installer validates custom ports and preserves an existing environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "coralconsole-install-custom-"));
  try {
    const binDirectory = await createFakeDockerBin(root);
    const installDirectory = join(root, "coralconsole");
    await createInstallFolder(installDirectory);

    const initial = runInstaller(installDirectory, binDirectory, "\n4500\n\n\n", {
      FAKE_BUSY_PORTS: "4500",
    });
    assert.equal(initial.status, 0, initial.stderr);
    assert.match(initial.stderr, /Port 4500 is already in use/);
    const originalEnvironment = await readFile(join(installDirectory, ".env"), "utf8");
    assert.equal(parseEnvironment(originalEnvironment).CORAL_PORT, "4501");

    const resumed = runInstaller(installDirectory, binDirectory, "");
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.match(resumed.stdout, /Existing \.env found/);
    assert.equal(await readFile(join(installDirectory, ".env"), "utf8"), originalEnvironment);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installer reserves ports configured by stopped CoralConsole installations", async () => {
  const root = await mkdtemp(join(tmpdir(), "coralconsole-install-reserved-"));
  try {
    const binDirectory = await createFakeDockerBin(root);
    const installDirectory = join(root, "coralconsole");
    await createInstallFolder(installDirectory);

    const result = runInstaller(installDirectory, binDirectory, "\n\n\n", {
      FAKE_RESERVED_PORTS: "3000,39000",
    });
    assert.equal(result.status, 0, result.stderr);
    const environment = parseEnvironment(await readFile(join(installDirectory, ".env"), "utf8"));
    assert.equal(environment.CORAL_PORT, "3001");
    assert.equal(environment.CORAL_INTERNAL_PORT, "39001");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installer reprompts when a port is claimed between validation and Docker startup", async () => {
  const root = await mkdtemp(join(tmpdir(), "coralconsole-install-race-"));
  try {
    const binDirectory = await createFakeDockerBin(root);
    const installDirectory = join(root, "coralconsole");
    await createInstallFolder(installDirectory);
    const statePath = join(root, "late-port-state");

    const result = runInstaller(installDirectory, binDirectory, "\n\n\n\n", {
      FAKE_LATE_BUSY_PORT: "3000",
      FAKE_DOCKER_STATE: statePath,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /became unavailable during startup/);
    const environment = parseEnvironment(await readFile(join(installDirectory, ".env"), "utf8"));
    assert.equal(environment.CORAL_PORT, "3001");
    assert.equal(environment.CORAL_INTERNAL_PORT, "39000");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release installer rejects unsupported host operating systems before writing configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "coralconsole-install-platform-"));
  try {
    const binDirectory = await createFakeDockerBin(root);
    const installDirectory = join(root, "coralconsole");
    await createInstallFolder(installDirectory);
    const result = runInstaller(installDirectory, binDirectory, "", { FAKE_UNAME_SYSTEM: "Darwin" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /supports native Linux/);
    await assert.rejects(readFile(join(installDirectory, ".env"), "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createReleaseRepository(root) {
  const files = new Map([
    ["package.json", `${JSON.stringify({ name: "coral-console", version: "9.8.7", scripts: {} }, null, 2)}\n`],
    ["package-lock.json", `${JSON.stringify({ name: "coral-console", version: "9.8.7", lockfileVersion: 3, packages: { "": { version: "9.8.7" } } }, null, 2)}\n`],
    ["Dockerfile", "FROM scratch\n"],
    ["Dockerfile.dev", "FROM scratch\n"],
    ["docker-compose.yml", "services: {}\n"],
    ["docker-compose.dev.yml", "services: {}\n"],
    ["README.md", "# CoralConsole\n"],
    ["DEPLOYMENT.md", "# Deployment\n"],
    ["AGENTS.md", "# Guide\n"],
    ["LICENSE", "Apache-2.0\n"],
    [".gitignore", "/dist/\n"],
    ["drizzle/meta/_journal.json", "{}\n"],
    ["scripts/migrate.mjs", "\n"],
    ["scripts/docker-common.sh", "\n"],
    ["scripts/docker-command.sh", "\n"],
  ]);
  const executableFiles = [
    "install.sh",
    "scripts/docker-start.sh",
    "scripts/docker-stop.sh",
    "scripts/docker-release.sh",
    "scripts/docker-dev-start.sh",
    "scripts/docker-dev-stop.sh",
    "scripts/docker-dev-rebuild.sh",
    "scripts/docker-backup.sh",
  ];

  for (const [relativePath, contents] of files) {
    const absolutePath = join(root, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents);
  }
  for (const relativePath of executableFiles) {
    const absolutePath = join(root, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, "#!/bin/sh\n", { mode: 0o755 });
  }
  await cp(join(projectRoot, "scripts/package-release.mjs"), join(root, "scripts/package-release.mjs"));

  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "CoralConsole Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "release fixture"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["tag", "v9.8.7"], { cwd: root });
}

test("release packaging creates a verified source archive and checksum from a clean tag", async () => {
  const root = await mkdtemp(join(tmpdir(), "coralconsole-package-test-"));
  try {
    await createReleaseRepository(root);
    const result = spawnSync(process.execPath, ["scripts/package-release.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);

    const archivePath = join(root, "dist", "releases", "coralconsole-9.8.7.tar.gz");
    const checksumPath = `${archivePath}.sha256`;
    const archive = await readFile(archivePath);
    const checksum = createHash("sha256").update(archive).digest("hex");
    assert.equal(await readFile(checksumPath, "utf8"), `${checksum}  ${basename(archivePath)}\n`);

    const listing = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
    assert.match(listing, /^coralconsole-9\.8\.7\//m);
    assert.match(listing, /coralconsole-9\.8\.7\/install\.sh/);
    assert.doesNotMatch(listing, /(?:^|\/)\.env$/m);
    assert.doesNotMatch(listing, /node_modules|\.git\//);

    const archiveBeforeRefusal = await readFile(archivePath);
    const existingResult = spawnSync(process.execPath, ["scripts/package-release.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.notEqual(existingResult.status, 0);
    assert.match(existingResult.stderr, /Refusing to overwrite/);
    assert.deepEqual(await readFile(archivePath), archiveBeforeRefusal);

    await writeFile(join(root, "README.md"), "dirty\n");
    const dirtyResult = spawnSync(process.execPath, ["scripts/package-release.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.notEqual(dirtyResult.status, 0);
    assert.match(dirtyResult.stderr, /clean Git worktree/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("version selection suggests semantic increments and still supports explicit versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "coralconsole-version-test-"));
  try {
    await mkdir(join(root, "scripts"), { recursive: true });
    await cp(join(projectRoot, "scripts/set-version.mjs"), join(root, "scripts/set-version.mjs"));
    const packageMetadata = { name: "coral-console", version: "1.3.4" };
    const packageLock = {
      name: "coral-console",
      version: "1.3.4",
      lockfileVersion: 3,
      packages: { "": { name: "coral-console", version: "1.3.4" } },
    };
    await Promise.all([
      writeFile(join(root, "package.json"), `${JSON.stringify(packageMetadata, null, 2)}\n`),
      writeFile(join(root, "package-lock.json"), `${JSON.stringify(packageLock, null, 2)}\n`),
    ]);

    const interactive = spawnSync(process.execPath, ["scripts/set-version.mjs"], {
      cwd: root,
      input: "2\n",
      encoding: "utf8",
    });
    assert.equal(interactive.status, 0, interactive.stderr);
    assert.match(interactive.stdout, /1\.3\.5\s+patch \(recommended\)/);
    assert.match(interactive.stdout, /CoralConsole version set to 1\.4\.0/);
    assert.equal(JSON.parse(await readFile(join(root, "package.json"), "utf8")).version, "1.4.0");
    assert.equal(JSON.parse(await readFile(join(root, "package-lock.json"), "utf8")).packages[""].version, "1.4.0");

    const explicit = spawnSync(process.execPath, ["scripts/set-version.mjs", "2.0.0"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.match(explicit.stdout, /CoralConsole version set to 2\.0\.0/);

    const downgrade = spawnSync(process.execPath, ["scripts/set-version.mjs", "1.9.0"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.notEqual(downgrade.status, 0);
    assert.match(downgrade.stderr, /must be greater than the current version 2\.0\.0/);
    assert.equal(JSON.parse(await readFile(join(root, "package.json"), "utf8")).version, "2.0.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createVersionWorkflowRepository(root) {
  const repository = join(root, "repository");
  const origin = join(root, "origin.git");
  await mkdir(join(repository, "scripts"), { recursive: true });
  await Promise.all([
    cp(join(projectRoot, "scripts/set-version.mjs"), join(repository, "scripts/set-version.mjs")),
    cp(join(projectRoot, "scripts/set-version.sh"), join(repository, "scripts/set-version.sh")),
    writeFile(join(repository, "package.json"), `${JSON.stringify({ name: "coral-console", version: "1.3.4" }, null, 2)}\n`),
    writeFile(join(repository, "package-lock.json"), `${JSON.stringify({
      name: "coral-console",
      version: "1.3.4",
      lockfileVersion: 3,
      packages: { "": { name: "coral-console", version: "1.3.4" } },
    }, null, 2)}\n`),
  ]);
  await chmod(join(repository, "scripts/set-version.sh"), 0o755);

  execFileSync("git", ["init", "-b", "main"], { cwd: repository, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "CoralConsole Test"], { cwd: repository });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repository });
  execFileSync("git", ["add", "."], { cwd: repository });
  execFileSync("git", ["commit", "-m", "initial fixture"], { cwd: repository, stdio: "ignore" });
  execFileSync("git", ["init", "--bare", origin], { stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", origin], { cwd: repository });
  execFileSync("git", ["push", "-u", "origin", "main"], { cwd: repository, stdio: "ignore" });
  return { origin, repository };
}

test("set-version workflow commits, tags, and atomically pushes a clean synchronized main", async () => {
  const root = await mkdtemp(join(tmpdir(), "coralconsole-version-workflow-"));
  try {
    const { origin, repository } = await createVersionWorkflowRepository(root);
    const result = spawnSync("/bin/sh", ["scripts/set-version.sh", "1.4.0"], {
      cwd: repository,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /committed, tagged as v1\.4\.0, and pushed to origin/);
    assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: repository, encoding: "utf8" }), "");
    assert.equal(JSON.parse(await readFile(join(repository, "package.json"), "utf8")).version, "1.4.0");
    assert.equal(JSON.parse(await readFile(join(repository, "package-lock.json"), "utf8")).packages[""].version, "1.4.0");
    assert.equal(execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: repository, encoding: "utf8" }).trim(), "Set version 1.4.0");
    assert.equal(execFileSync("git", ["cat-file", "-t", "v1.4.0"], { cwd: repository, encoding: "utf8" }).trim(), "tag");

    const localCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
    const remoteCommit = execFileSync("git", ["--git-dir", origin, "rev-parse", "refs/heads/main"], { encoding: "utf8" }).trim();
    const remoteTaggedCommit = execFileSync("git", ["--git-dir", origin, "rev-parse", "refs/tags/v1.4.0^{}"], { encoding: "utf8" }).trim();
    assert.equal(remoteCommit, localCommit);
    assert.equal(remoteTaggedCommit, localCommit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("set-version workflow refuses dirty or unpublished main commits before changing versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "coralconsole-version-preflight-"));
  try {
    const { repository } = await createVersionWorkflowRepository(root);
    await writeFile(join(repository, "untracked.txt"), "pending\n");
    const dirtyResult = spawnSync("/bin/sh", ["scripts/set-version.sh", "1.4.0"], {
      cwd: repository,
      encoding: "utf8",
    });
    assert.notEqual(dirtyResult.status, 0);
    assert.match(dirtyResult.stderr, /pending modifications/);
    assert.equal(JSON.parse(await readFile(join(repository, "package.json"), "utf8")).version, "1.3.4");
    await rm(join(repository, "untracked.txt"));

    await writeFile(join(repository, "README.md"), "local commit\n");
    execFileSync("git", ["add", "README.md"], { cwd: repository });
    execFileSync("git", ["commit", "-m", "unpublished work"], { cwd: repository, stdio: "ignore" });
    const aheadResult = spawnSync("/bin/sh", ["scripts/set-version.sh", "1.4.0"], {
      cwd: repository,
      encoding: "utf8",
    });
    assert.notEqual(aheadResult.status, 0);
    assert.match(aheadResult.stderr, /must exactly match origin\/main/);
    assert.equal(JSON.parse(await readFile(join(repository, "package.json"), "utf8")).version, "1.3.4");
    assert.throws(
      () => execFileSync("git", ["show-ref", "--verify", "refs/tags/v1.4.0"], { cwd: repository, stdio: "ignore" }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
