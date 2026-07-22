import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders CoralConsole", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>CoralConsole<\/title>/i);
  assert.match(html, /CoralConsole/);
  assert.match(html, /Hide intro/);
  assert.match(html, /Every actor/);
  assert.match(html, /Actor map/);
  assert.match(html, /Add actor/);
  assert.match(html, /SEQ-NYC-01/);
  assert.match(html, /Sequencer Fabric/);
  assert.match(html, /Primary Sequencer/);
  assert.match(html, /Backup Sequencers/);
  assert.match(html, /Replayer Fabric/);
  assert.match(html, /Replayers/);
  assert.match(html, /BRIDGE-LDN-01/);
  assert.match(html, /DISPATCH-01/);
  assert.match(html, /LOGGER-01/);
  assert.match(html, /Application Layer/);
  assert.match(html, /Nodes · Applications/);
  assert.match(html, /Bridge · Dispatcher · MultiMqApp/);
  assert.doesNotMatch(html, /Bridge · Dispatcher · Link/);
  assert.match(html, /System Pulse/);
  assert.match(html, />Healthy</);
  assert.match(html, />Unhealthy</);
  const summaryLabels = [
    "1 Sequencer",
    "1 Backup Sequencers",
    "3 Replayers",
    "1 Archivers",
    "1 Loggers",
    "1 Bridges",
    "1 Dispatchers",
    "1 Nodes",
    "2 Applications",
    "0 MultiMqApps",
  ];
  let previousSummaryIndex = -1;
  for (const label of summaryLabels) {
    const index = html.indexOf(`aria-label="${label}"`);
    assert.ok(index > previousSummaryIndex, `${label} should appear in the requested summary order`);
    previousSummaryIndex = index;
  }
  assert.doesNotMatch(html, /aria-label="0 Links"/);
  assert.match(html, /lucide-orbit/);
  assert.match(html, /lucide-waypoints/);
  assert.match(html, /lucide-memory-stick/);
  assert.match(html, /2607171725/);
  assert.match(html, /Started 17 Jul 2026 · 17:25/);
  assert.match(html, /href="\/actor\/demo-seq-01"/);
  assert.match(html, /target="_blank"/);
  assert.doesNotMatch(html, /Run an action/);
  assert.doesNotMatch(html, /total-ordered delivery/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("server-renders the dedicated actor detail route", async () => {
  const response = await render("/actor/demo-seq-01");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Actor detail/);
  assert.match(html, /Loading actor/);
  assert.doesNotMatch(html, /Actor map/);
});

test("keeps discovery, local persistence, and the REST relay explicit", async () => {
  const [page, actorUi, actorDetail, route, guide, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/actor-ui.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/actor/[id]/actor-detail.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/actor/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../AGENTS.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /coral-console-actors/);
  assert.match(page, /coral-console-intro/);
  assert.match(page, /callActor\(\{ host: host\.trim\(\), port: numericPort \}, "list"\)/);
  assert.match(page, /`\$\{scope\} status`/);
  assert.match(page, /sessionStartFromId/);
  assert.match(page, /sessionStartFromStatus/);
  assert.match(page, /ACTOR_KINDS\.map/);
  assert.match(page, /className="system-overview"/);
  assert.match(page, /className="pulse-panel"/);
  assert.match(page, /kinds: \["bridge", "dispatcher", "multimqapp"\]/);
  assert.match(page, /kinds: \["node", "application"\]/);
  assert.match(page, /group\.kinds\.flatMap/);
  for (const actorType of ["Sequencer", "Backup Sequencer", "Replayer", "Archiver", "Logger", "Bridge", "Dispatcher", "Node", "Application", "Link", "MultiMqApp"]) {
    assert.match(actorUi, new RegExp(`label: "${actorType}"`));
  }
  assert.match(page, /SUMMARY_KINDS/);
  assert.match(page, /kind !== "link"/);
  assert.match(actorUi, /icon: Orbit/);
  assert.match(page, /target="_blank"/);
  assert.match(page, /saveActorSnapshot/);
  assert.doesNotMatch(page, /Run an action/);
  assert.match(actorDetail, /Run an action/);
  assert.match(actorDetail, /callActor/);
  assert.match(route, /adminCommand/);
  assert.match(route, /6500/);
  assert.match(guide, /Keep this file current/);
  assert.match(guide, /Never show Links in the summary/);
  assert.match(guide, /open `\/actor\/<id>` in a new browser tab/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
