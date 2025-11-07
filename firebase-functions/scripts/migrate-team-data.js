"use strict";

/**
 * Usage:
 *   cd functions
 *   npm install
 *   export GOOGLE_APPLICATION_CREDENTIALS=path/to/serviceAccount.json
 *   node scripts/migrate-team-data.js
 *
 * The script normalizes legacy team values on athlete profiles, copies
 * attendance documents to the new team ids, and seeds roles/{uid}.teamScopes
 * so Firestore rules can enforce sport-specific access.
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const db = getFirestore();

const TEAM_DEFINITIONS = [
  {
    id: "football-varsity",
    label: "Football - Varsity",
    sport: "football",
    program: "coed",
    legacy: ["varsity", "football varsity", "fb varsity"],
  },
  {
    id: "football-junior-high",
    label: "Football - Junior High",
    sport: "football",
    program: "coed",
    legacy: ["jh", "junior high", "football jh"],
  },
  {
    id: "girls-basketball-varsity",
    label: "Girls Basketball - Varsity",
    sport: "basketball",
    program: "girls",
    legacy: ["girls basketball varsity", "girls bball varsity"],
  },
  {
    id: "girls-basketball-junior-high",
    label: "Girls Basketball - Junior High",
    sport: "basketball",
    program: "girls",
    legacy: ["girls basketball junior high", "girls bball jh"],
  },
  {
    id: "boys-basketball-varsity",
    label: "Boys Basketball - Varsity",
    sport: "basketball",
    program: "boys",
    legacy: ["boys basketball varsity", "boys bball varsity"],
  },
  {
    id: "boys-basketball-junior-high",
    label: "Boys Basketball - Junior High",
    sport: "basketball",
    program: "boys",
    legacy: ["boys basketball junior high", "boys bball jh"],
  },
];

const TEAM_LOOKUP = TEAM_DEFINITIONS.reduce((acc, def) => {
  acc[def.id.toLowerCase()] = def.id;
  (def.legacy || []).forEach((alias) => {
    acc[alias.toLowerCase()] = def.id;
  });
  return acc;
}, {});

const DEFAULT_SCOPE = TEAM_DEFINITIONS.filter(
  (def) => def.sport === "football" && def.program === "coed"
).map((def) => def.id);

function normalizeTeam(value) {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return TEAM_LOOKUP[key] || null;
}

function resolveTeamScopes(teamId) {
  const definition = TEAM_DEFINITIONS.find((def) => def.id === teamId);
  if (!definition) {
    return DEFAULT_SCOPE;
  }
  return TEAM_DEFINITIONS.filter(
    (def) => def.sport === definition.sport && def.program === definition.program
  ).map((def) => def.id);
}

async function migrateProfiles() {
  console.log("Scanning athlete/profile documents...");
  const snap = await db.collectionGroup("profile").get();
  const coachTeams = new Map();
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const parts = docSnap.ref.path.split("/");
    const uid = parts[1];
    const normalized = normalizeTeam(data.team);
    if (normalized && normalized !== data.team) {
      await docSnap.ref.set({ team: normalized }, { merge: true });
      console.log(`• Updated team for profile ${docSnap.ref.path} -> ${normalized}`);
    }
    if (normalized) {
      coachTeams.set(uid, normalized);
    }
  }
  console.log(`Profile migration complete (${snap.size} docs scanned).`);
  return coachTeams;
}

async function migrateRoles(coachTeams) {
  console.log("Ensuring roles/{uid}.teamScopes is populated...");
  const snap = await db.collection("roles").get();
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const roles = Array.isArray(data.roles) ? data.roles : [];
    const hasCoachAccess = roles.includes("coach") || roles.includes("admin");
    if (!hasCoachAccess) continue;
    const scopes = Array.isArray(data.teamScopes) ? data.teamScopes : [];
    if (scopes.length > 0) continue;
    const anchor = coachTeams.get(docSnap.id) || null;
    const resolvedScopes = resolveTeamScopes(anchor);
    await docSnap.ref.set(
      {
        teamAnchor: anchor,
        teamScopes: resolvedScopes,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`• Seeded teamScopes for roles/${docSnap.id} -> ${resolvedScopes.join(", ")}`);
  }
  console.log("Role documents updated.");
}

async function migrateAttendance() {
  console.log("Migrating attendance documents...");
  const snap = await db.collection("attendance").get();
  for (const docSnap of snap.docs) {
    const currentId = docSnap.id;
    const normalized = normalizeTeam(currentId);
    if (!normalized || normalized === currentId) continue;
    const targetRef = db.collection("attendance").doc(normalized);
    const targetSnap = await targetRef.get();
    if (targetSnap.exists) {
      console.warn(
        `! Skipping attendance ${currentId} -> ${normalized} because destination already exists.`
      );
      continue;
    }
    await targetRef.set(docSnap.data(), { merge: true });
    await docSnap.ref.delete();
    console.log(`• Renamed attendance/${currentId} -> attendance/${normalized}`);
  }
  console.log("Attendance migration complete.");
}

async function main() {
  const coachTeams = await migrateProfiles();
  await migrateRoles(coachTeams);
  await migrateAttendance();
}

main()
  .then(() => {
    console.log("Team migration complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
