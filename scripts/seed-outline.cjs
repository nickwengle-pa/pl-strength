#!/usr/bin/env node
/**
 * Seed the programOutline document to Firestore using Firebase Admin SDK.
 * Run with: node scripts/seed-outline.js
 */

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");

const seedData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "programOutlineSeed.json"), "utf8")
);

async function main() {
  // Initialize with Application Default Credentials (uses firebase login)
  initializeApp({
    credential: applicationDefault(),
    projectId: "pl-strength",
  });

  const db = getFirestore();
  const docRef = db.collection("config").doc("programOutline");

  console.log("Seeding config/programOutline...");
  await docRef.set(seedData, { merge: true });
  console.log("Done! Document seeded successfully.");
}

main().catch((err) => {
  console.error("Failed to seed:", err.message);
  process.exit(1);
});
