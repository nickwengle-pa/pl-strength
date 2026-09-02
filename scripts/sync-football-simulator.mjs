import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UPSTREAM = resolve(process.env.FOOTBALL_SIMULATOR_REPO ?? "D:\\APPS\\football");
const LOCK_PATH = resolve(ROOT, "football-simulator.lock.json");
const artifacts = [
  {
    name: "html",
    source: resolve(UPSTREAM, "heritage_conference_power_points_simulator_25_26v1.html"),
    destination: resolve(ROOT, "public/football-simulator.html")
  },
  {
    name: "feed2026",
    source: resolve(UPSTREAM, "data/football-2026.json"),
    destination: resolve(ROOT, "public/data/football-2026.json")
  },
  {
    name: "feedScript2026",
    source: resolve(UPSTREAM, "data/football-2026.js"),
    destination: resolve(ROOT, "public/data/football-2026.js")
  }
];

const sha256 = (value) => {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
};

async function readUpstreamCommit() {
  try {
    const head = (await readFile(resolve(UPSTREAM, ".git/HEAD"), "utf8")).trim();
    if (!head.startsWith("ref: ")) return head || null;
    return (await readFile(resolve(UPSTREAM, `.git/${head.slice(5)}`), "utf8")).trim() || null;
  } catch {
    return null;
  }
}

async function verify() {
  const lock = JSON.parse(await readFile(LOCK_PATH, "utf8"));
  let upstreamAvailable = true;
  try { await readFile(artifacts[0].source); } catch (error) {
    if (error?.code === "ENOENT") upstreamAvailable = false;
    else throw error;
  }
  for (const artifact of artifacts) {
    const actual = sha256(await readFile(artifact.destination));
    const expected = lock.artifacts?.[artifact.name]?.sha256;
    if (!expected || actual !== expected) {
      throw new Error(`${artifact.name} does not match football-simulator.lock.json. Run npm run sync:football.`);
    }
    if (upstreamAvailable) {
      const canonical = sha256(await readFile(artifact.source));
      if (actual !== canonical) {
        throw new Error(`${artifact.name} is stale compared with D:\\APPS\\football. Run npm run sync:football.`);
      }
    }
  }
  process.stdout.write(upstreamAvailable
    ? "Football simulator vendor artifacts match the canonical repo and lock file.\n"
    : "Football simulator vendor artifacts match their lock file (canonical repo unavailable).\n");
}

async function sync() {
  const lockArtifacts = {};
  for (const artifact of artifacts) {
    const contents = await readFile(artifact.source);
    await mkdir(dirname(artifact.destination), { recursive: true });
    await writeFile(artifact.destination, contents);
    lockArtifacts[artifact.name] = {
      path: artifact.destination.slice(ROOT.length + 1).replaceAll("\\", "/"),
      sha256: sha256(contents),
      bytes: contents.length
    };
  }
  const lock = {
    schemaVersion: 1,
    upstream: "https://github.com/nickwengle-pa/football",
    upstreamCommit: await readUpstreamCommit(),
    upstreamState: "working-tree snapshot",
    syncedAt: new Date().toISOString(),
    artifacts: lockArtifacts
  };
  await writeFile(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  process.stdout.write("Synced the canonical football simulator HTML and 2026 feed.\n");
}

if (process.argv.includes("--check")) await verify();
else await sync();
