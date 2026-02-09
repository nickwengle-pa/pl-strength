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
  .onWrite(async (change, context) => {
    const snap = change.after;
    if (!snap.exists) {
      return;
    }

    const payload = snap.data() ?? {};
    const targetUid =
      (typeof payload.uid === "string" && payload.uid.trim()) || context.params.uid;
    const queueDocId = context.params.uid;
    const status =
      typeof payload.status === "string" && payload.status.trim()
        ? payload.status.trim().toLowerCase()
        : "pending";

    if (!targetUid) {
      functions.logger.warn("Queue document missing UID", {
        context: context.params,
        queueDocId,
      });
      await snap.ref.delete();
      return;
    }

    if (status !== "pending") {
      functions.logger.debug("Skipping queue document with non-pending status", {
        queueDocId,
        targetUid,
        status,
      });
      return;
    }

    const previous = change.before.exists ? change.before.data() ?? {} : {};
    const attemptCount =
      typeof previous.attemptCount === "number" && Number.isFinite(previous.attemptCount)
        ? previous.attemptCount + 1
        : 1;

    await snap.ref.set(
      {
        status: "processing",
        attemptCount,
        lastAttemptAt: FieldValue.serverTimestamp(),
        lastError: FieldValue.delete(),
        lastErrorCode: FieldValue.delete(),
      },
      { merge: true }
    );

    functions.logger.info("Deleting auth user from queue", {
      queueDocId,
      targetUid,
      attemptCount,
    });

    try {
      await getAuth().deleteUser(targetUid);
    } catch (error) {
      const code =
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "unknown";
      const message = error instanceof Error ? error.message : String(error);

      if (code === "auth/user-not-found") {
        functions.logger.info("Auth user already deleted; removing queue doc", {
          queueDocId,
          targetUid,
          attemptCount,
        });
        await snap.ref.delete();
        return;
      }

      functions.logger.error("Failed to delete auth user", {
        queueDocId,
        targetUid,
        attemptCount,
        errorCode: code,
        errorMessage: message,
        errorStack: error instanceof Error ? error.stack : undefined,
      });

      await snap.ref.set(
        {
          status: "failed",
          lastErrorCode: code,
          lastError: message,
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
        queueDocId,
        targetUid,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }

    functions.logger.info("Removed auth user and queue doc", {
      queueDocId,
      targetUid,
      attemptCount,
    });
  });
