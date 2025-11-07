"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue } = require("firebase-admin/firestore");
const functions = require("firebase-functions");

// Initialize the Admin SDK once per process.
initializeApp();

/**
 * Background worker that reacts to documents written into the
 * __deleteAuthUser__ collection. The roster UI writes the UID there whenever
 * a coach should be fully removed. We delete the corresponding Firebase Auth
 * account and clean up the queue entry.
 */
exports.handleDeleteAuthUserQueue = functions.firestore
  .document("__deleteAuthUser__/{uid}")
  .onCreate(async (snap, context) => {
    const payload = snap.data() ?? {};
    const targetUid =
      (typeof payload.uid === "string" && payload.uid.trim()) || context.params.uid;

    if (!targetUid) {
      functions.logger.warn("Queue document missing UID", { context: context.params });
      await snap.ref.delete();
      return;
    }

    functions.logger.info("Deleting auth user from queue", { targetUid });

    try {
      await getAuth().deleteUser(targetUid);
    } catch (error) {
      functions.logger.error("Failed to delete auth user", {
        targetUid,
        error: error instanceof Error ? error.message : error,
      });

      await snap.ref.set(
        {
          lastError: error instanceof Error ? error.message : String(error),
          lastAttemptAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }

    try {
      await snap.ref.delete();
    } catch (error) {
      functions.logger.error("Deleted auth user but failed to remove queue doc", {
        targetUid,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }

    functions.logger.info("Removed auth user and queue doc", { targetUid });
  });
