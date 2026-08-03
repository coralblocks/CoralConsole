import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");

async function copyScriptFixture(root, names) {
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(join(root, ".env"), "COMPOSE_PROJECT_NAME=operator-script-test\n");
  for (const name of new Set(["docker-common.sh", ...names])) {
    const destination = join(root, "scripts", name);
    await copyFile(join(projectRoot, "scripts", name), destination);
    await chmod(destination, 0o755);
  }
}

async function createFakeTools(root) {
  const bin = join(root, "fake-bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "docker"), `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
case "\${1:-}" in
  info) exit 0 ;;
  compose)
    case "\${2:-}" in
      version) echo "Docker Compose version v2.30.0"; exit 0 ;;
      ps) echo "running-coralconsole"; exit 0 ;;
      build) exit 0 ;;
      exec)
        case "$*" in
          *scripts/export-actors.mjs*)
            printf 'account,host,port,kind\\nNODE-A,10.0.0.1,30001,node\\n'
            echo "Exported 1 actor." >&2
            exit 0
            ;;
          *scripts/import-actors.mjs*)
            cat > "$FAKE_IMPORT_CAPTURE"
            echo "Imported 1 actor."
            exit 0
            ;;
        esac
        ;;
    esac
    ;;
esac
echo "Unexpected fake Docker command: $*" >&2
exit 1
`, { mode: 0o755 });

  for (const command of ["node", "npm"]) {
    await writeFile(join(bin, command), `#!/bin/sh
echo "host ${command} was invoked" >> "$FAKE_FORBIDDEN_LOG"
exit 97
`, { mode: 0o755 });
  }
  return bin;
}

function runScript(root, bin, name, args = []) {
  return spawnSync("/bin/sh", [join(root, "scripts", name), ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_DOCKER_LOG: join(root, "docker.log"),
      FAKE_FORBIDDEN_LOG: join(root, "forbidden.log"),
      FAKE_IMPORT_CAPTURE: join(root, "imported.csv"),
    },
  });
}

test("server build helper invokes Docker without host Node or npm", async () => {
  const root = await mkdtemp(join(tmpdir(), "coralconsole-build-script-"));
  try {
    await copyScriptFixture(root, ["build-site.sh", "docker-command.sh"]);
    const bin = await createFakeTools(root);
    const result = runScript(root, bin, "build-site.sh");
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(join(root, "docker.log"), "utf8"), /^compose build$/m);
    await assert.rejects(readFile(join(root, "forbidden.log"), "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("actor transfer shell commands keep Node inside Docker", async () => {
  const root = await mkdtemp(join(tmpdir(), "coralconsole-actor-scripts-"));
  try {
    await copyScriptFixture(root, ["actors-export.sh", "actors-import.sh"]);
    const bin = await createFakeTools(root);

    const exported = runScript(root, bin, "actors-export.sh", ["actors.csv"]);
    assert.equal(exported.status, 0, exported.stderr);
    assert.match(exported.stdout, /Saved actor export to actors\.csv/);
    assert.equal(
      await readFile(join(root, "actors.csv"), "utf8"),
      "account,host,port,kind\nNODE-A,10.0.0.1,30001,node\n",
    );
    assert.equal((await stat(join(root, "actors.csv"))).mode & 0o777, 0o600);

    const repeated = runScript(root, bin, "actors-export.sh", ["actors.csv"]);
    assert.notEqual(repeated.status, 0);
    assert.match(repeated.stderr, /Refusing to overwrite/);

    const imported = runScript(root, bin, "actors-import.sh", ["actors.csv"]);
    assert.equal(imported.status, 0, imported.stderr);
    assert.match(imported.stdout, /Imported 1 actor/);
    assert.equal(
      await readFile(join(root, "imported.csv"), "utf8"),
      "account,host,port,kind\nNODE-A,10.0.0.1,30001,node\n",
    );

    await assert.rejects(readFile(join(root, "forbidden.log"), "utf8"), /ENOENT/);
    const dockerLog = await readFile(join(root, "docker.log"), "utf8");
    assert.match(dockerLog, /compose exec -T coralconsole node scripts\/export-actors\.mjs --internal-database-mode/);
    assert.match(dockerLog, /compose exec -T coralconsole node scripts\/import-actors\.mjs --internal-database-mode/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("documented server scripts do not launch host Node or npm", async () => {
  const names = [
    "actors-export.sh",
    "actors-import.sh",
    "build-site.sh",
    "colima-start.sh",
  ];
  for (const name of names) {
    const source = await readFile(join(projectRoot, "scripts", name), "utf8");
    assert.doesNotMatch(source, /(?:^|\n)\s*(?:exec\s+)?(?:node|npm)(?:\s|$)/, name);
  }

  for (const name of ["README.md", "DEPLOYMENT.md", "AGENTS.md"]) {
    const source = await readFile(join(projectRoot, name), "utf8");
    assert.doesNotMatch(source, /npm run (?:actors:|docker:)/, name);
  }
});
