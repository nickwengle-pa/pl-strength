"use strict";

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const functions = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const crypto = require("crypto");

// Initialize the Admin SDK once per process.
initializeApp();
const AUTH_DELETE_QUEUE_COLLECTION = "authDeleteQueue";
const ATTENDANCE_COLLECTION = "attendance";
const ATTENDANCE_STATUS_COLLECTION = "attendanceStatus";
const ATTENDANCE_CHECKINS_COLLECTION = "attendanceCheckins";
const JUNIOR_HIGH_TEAM = "football-junior-high";

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const sanitizeName = (value) =>
  typeof value === "string" ? value.trim().slice(0, 60) : "";

const sanitizeSessionKey = (value) => {
  if (typeof value !== "string") return "";
  const raw = value.trim().slice(0, 60);
  return raw.replace(/[^a-zA-Z0-9_-]/g, "-");
};

const sanitizeSessionLabel = (value) =>
  typeof value === "string" ? value.trim().slice(0, 60) : "";

const sanitizeDate = (value) =>
  typeof value === "string" ? value.trim().slice(0, 40) : "";

const normalizeDateList = (value) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((entry) => (typeof entry === "string" ? entry.trim().slice(0, 40) : ""))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

const normalizeSessionsForDate = (value, fallbackSession) => {
  const rows = [];
  const seenKeys = new Set();
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
      const keyCandidate = sanitizeSessionKey(entry.key);
      const labelCandidate = sanitizeSessionLabel(entry.label);
      let key = keyCandidate || `session-${index + 1}`;
      if (!key) key = `session-${index + 1}`;
      while (seenKeys.has(key)) {
        key = `${key}-${seenKeys.size + 1}`;
      }
      seenKeys.add(key);
      rows.push({
        key,
        label: labelCandidate || `Session ${index + 1}`,
      });
    });
  }
  if (rows.length > 0) return rows;
  if (fallbackSession) {
    return [
      {
        key: sanitizeSessionKey(fallbackSession.key) || "session-1",
        label: sanitizeSessionLabel(fallbackSession.label) || "After School",
      },
    ];
  }
  return [{ key: "session-1", label: "After School" }];
};

const normalizeSessionLocksForDate = (value, sessions) => {
  const source = asObject(value);
  const locks = {};
  sessions.forEach((session) => {
    locks[session.key] = source[session.key] === true;
  });
  return locks;
};

const normalizeNameToken = (value) => sanitizeName(value).toLowerCase();

const buildAttendanceAthleteIdForUid = (uid) =>
  `uid-${uid}`.replace(/[^a-zA-Z0-9_-]/g, "_");

const buildAttendanceDayKey = (team, date) => `${team}__${date}`;

const findMatchingAttendanceAthleteIndex = (athletes, checkin) => {
  if (checkin.athleteId) {
    const byId = athletes.findIndex((athlete) => athlete.id === checkin.athleteId);
    if (byId >= 0) return byId;
  }
  const byUid = athletes.findIndex(
    (athlete) =>
      athlete &&
      typeof athlete === "object" &&
      athlete.level === checkin.team &&
      athlete.uid === checkin.uid
  );
  if (byUid >= 0) return byUid;

  const first = normalizeNameToken(checkin.firstName);
  const last = normalizeNameToken(checkin.lastName);
  if (!first || !last) return -1;

  return athletes.findIndex(
    (athlete) =>
      athlete &&
      typeof athlete === "object" &&
      athlete.level === checkin.team &&
      normalizeNameToken(athlete.firstName) === first &&
      normalizeNameToken(athlete.lastName) === last
  );
};

/**
 * Background worker that reacts to documents written into the
 * authDeleteQueue collection. The roster UI writes the UID there whenever
 * a coach should be fully removed. We delete the corresponding Firebase Auth
 * account and clean up the queue entry.
 */
exports.handleDeleteAuthUserQueue = functions.firestore
  .document(`${AUTH_DELETE_QUEUE_COLLECTION}/{uid}`)
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

/**
 * Auto-approve attendance check-ins for Football Junior High and write them
 * directly into the attendance sheet. This keeps athlete-side permissions narrow
 * while still allowing no-review flow for this team.
 */
exports.autoApproveJuniorHighAttendanceCheckin = functions.firestore
  .document(`${ATTENDANCE_CHECKINS_COLLECTION}/{docId}`)
  .onCreate(async (snap, context) => {
    const payload = snap.data() ?? {};
    const team = typeof payload.team === "string" ? payload.team.trim() : "";
    if (team !== JUNIOR_HIGH_TEAM) {
      return;
    }

    const date = sanitizeDate(payload.date);
    const uid = typeof payload.uid === "string" ? payload.uid.trim() : "";
    if (!date || !uid) {
      functions.logger.warn("Skipping junior-high checkin with missing identifiers", {
        docId: context.params.docId,
        team,
        date,
        uid,
      });
      return;
    }

    const db = getFirestore();
    const checkinRef = snap.ref;
    const statusRef = db.collection(ATTENDANCE_STATUS_COLLECTION).doc(team);
    const attendanceRef = db.collection(ATTENDANCE_COLLECTION).doc(team);

    await db.runTransaction(async (tx) => {
      const [checkinSnap, statusSnap, attendanceSnap] = await Promise.all([
        tx.get(checkinRef),
        tx.get(statusRef),
        tx.get(attendanceRef),
      ]);
      if (!checkinSnap.exists) return;

      const checkinData = checkinSnap.data() ?? {};
      const currentStatus =
        typeof checkinData.status === "string" ? checkinData.status.trim().toLowerCase() : "pending";
      if (currentStatus !== "pending") return;

      const statusData = statusSnap.exists ? statusSnap.data() ?? {} : {};
      const statusDates = normalizeDateList(statusData.dates);
      if (!statusDates.includes(date)) {
        tx.set(
          checkinRef,
          {
            status: "rejected",
            reviewedAt: FieldValue.serverTimestamp(),
            reviewedByName: "Auto (JH)",
          },
          { merge: true }
        );
        return;
      }

      const firstName = sanitizeName(checkinData.firstName);
      const lastName = sanitizeName(checkinData.lastName);
      const checkinSessionKey = sanitizeSessionKey(checkinData.sessionKey);
      const checkinSessionLabel = sanitizeSessionLabel(checkinData.sessionLabel);
      const fallbackSession = {
        key: checkinSessionKey || "session-1",
        label: checkinSessionLabel || "After School",
      };

      const statusSessionsByDate = asObject(statusData.sessionsByDate);
      const statusSessionLocksByDate = asObject(statusData.sessionLocks);
      const statusLockedDatesByDate = asObject(statusData.lockedDates);

      const sessionsForDate = normalizeSessionsForDate(
        statusSessionsByDate[date],
        fallbackSession
      );
      const sessionLocksForDate = normalizeSessionLocksForDate(
        statusSessionLocksByDate[date],
        sessionsForDate
      );
      const explicitDateLocked = statusLockedDatesByDate[date] === true;
      const allSessionsLocked =
        sessionsForDate.length > 0 &&
        sessionsForDate.every((session) => sessionLocksForDate[session.key] === true);
      const preferredSession = checkinSessionKey
        ? sessionsForDate.find(
            (session) =>
              session.key === checkinSessionKey && sessionLocksForDate[session.key] !== true
          ) ?? null
        : null;
      const firstUnlockedSession =
        sessionsForDate.find((session) => sessionLocksForDate[session.key] !== true) ?? null;
      const assignedSession = preferredSession ?? firstUnlockedSession;
      if (explicitDateLocked || allSessionsLocked || !assignedSession) {
        tx.set(
          checkinRef,
          {
            status: "rejected",
            reviewedAt: FieldValue.serverTimestamp(),
            reviewedByName: "Auto (JH)",
          },
          { merge: true }
        );
        return;
      }

      const attendanceData = attendanceSnap.exists ? attendanceSnap.data() ?? {} : {};
      const baseDates = normalizeDateList(attendanceData.dates);
      const nextDates = baseDates.includes(date)
        ? [...baseDates]
        : [...baseDates, date].sort((a, b) => a.localeCompare(b));

      const athletes = Array.isArray(attendanceData.athletes)
        ? attendanceData.athletes
            .filter((row) => row && typeof row === "object")
            .map((row) => ({ ...row }))
        : [];
      const records = { ...asObject(attendanceData.records) };
      const sessionSelections = { ...asObject(attendanceData.sessionSelections) };

      const attendanceSessionsByDate = asObject(attendanceData.sessionsByDate);
      const attendanceSessionLocksByDate = asObject(attendanceData.sessionLocks);
      const attendanceLockedDatesByDate = asObject(attendanceData.lockedDates);

      const nextSessionsByDate = {};
      const nextSessionLocksByDate = {};
      const nextLockedDates = {};
      nextDates.forEach((value) => {
        const sessions = normalizeSessionsForDate(
          attendanceSessionsByDate[value],
          normalizeSessionsForDate(statusSessionsByDate[value], fallbackSession)[0]
        );
        const locks = normalizeSessionLocksForDate(
          attendanceSessionLocksByDate[value] ?? statusSessionLocksByDate[value],
          sessions
        );
        const lockAll =
          attendanceLockedDatesByDate[value] === true || statusLockedDatesByDate[value] === true;
        const allLocked =
          sessions.length > 0 && sessions.every((session) => locks[session.key] === true);
        nextSessionsByDate[value] = sessions;
        nextSessionLocksByDate[value] = locks;
        nextLockedDates[value] = lockAll || allLocked;
      });

      // Always use attendance status as source of truth for the active check-in date.
      nextSessionsByDate[date] = sessionsForDate;
      nextSessionLocksByDate[date] = sessionLocksForDate;
      nextLockedDates[date] = explicitDateLocked || allSessionsLocked;

      const athleteIdFromCheckin =
        typeof checkinData.athleteId === "string" && checkinData.athleteId.trim()
          ? checkinData.athleteId.trim()
          : "";
      let athleteIndex = findMatchingAttendanceAthleteIndex(athletes, {
        team,
        uid,
        athleteId: athleteIdFromCheckin,
        firstName,
        lastName,
      });
      let athleteId = athleteIndex >= 0 ? athletes[athleteIndex].id : "";
      if (athleteIndex < 0) {
        const baseId = buildAttendanceAthleteIdForUid(uid);
        const existingIds = new Set(
          athletes
            .map((athlete) => (typeof athlete.id === "string" ? athlete.id : ""))
            .filter(Boolean)
        );
        athleteId = baseId;
        let suffix = 2;
        while (existingIds.has(athleteId)) {
          athleteId = `${baseId}-${suffix}`;
          suffix += 1;
        }
        athletes.push({
          id: athleteId,
          uid,
          firstName: firstName || "Athlete",
          lastName,
          level: team,
        });
        athleteIndex = athletes.length - 1;
      }

      const athleteRow = asObject(athletes[athleteIndex]);
      athletes[athleteIndex] = {
        ...athleteRow,
        id: athleteId,
        level:
          typeof athleteRow.level === "string" && athleteRow.level.trim() ? athleteRow.level : team,
        ...(typeof athleteRow.uid === "string" && athleteRow.uid.trim() ? {} : { uid }),
        ...(!athleteRow.firstName && firstName ? { firstName } : {}),
        ...(!athleteRow.lastName && lastName ? { lastName } : {}),
      };

      const row = { ...asObject(records[athleteId]) };
      nextDates.forEach((value) => {
        if (!(value in row)) row[value] = false;
      });
      row[date] = true;
      records[athleteId] = row;

      const selectionRow = { ...asObject(sessionSelections[athleteId]) };
      selectionRow[date] = assignedSession.key;
      sessionSelections[athleteId] = selectionRow;

      tx.set(
        attendanceRef,
        {
          dates: nextDates,
          athletes,
          records,
          sessionSelections,
          sessionsByDate: nextSessionsByDate,
          sessionLocks: nextSessionLocksByDate,
          lockedDates: nextLockedDates,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      tx.set(
        checkinRef,
        {
          dayKey: buildAttendanceDayKey(team, date),
          athleteId,
          ...(firstName ? { firstName } : {}),
          ...(lastName ? { lastName } : {}),
          sessionKey: assignedSession.key,
          sessionLabel: assignedSession.label,
          status: "approved",
          reviewedAt: FieldValue.serverTimestamp(),
          reviewedByName: "Auto (JH)",
        },
        { merge: true }
      );
    });

    functions.logger.info("Auto-approved junior-high attendance check-in", {
      docId: context.params.docId,
      team,
      date,
      uid,
    });
  });

// Weekly backup — runs every Sunday at 11:59 PM America/Chicago
// Exports attendance sheets, athlete profiles, and roles to Firebase Storage.
// Keeps the 8 most recent backups (approximately 2 months).
exports.weeklyBackup = onSchedule(
  { schedule: "59 23 * * 0", timeZone: "America/Chicago" },
  async () => {
    const db = getFirestore();
    const bucket = getStorage().bucket();
    const timestamp = new Date().toISOString().split("T")[0];

    const backup = {};

    // Attendance sheets (one document per team)
    const attendanceSnap = await db.collection(ATTENDANCE_COLLECTION).get();
    backup.attendance = {};
    attendanceSnap.forEach((doc) => {
      backup.attendance[doc.id] = doc.data();
    });

    // Athlete profiles (collection group across all athletes)
    const profileSnap = await db.collectionGroup("profile").get();
    backup.profiles = {};
    profileSnap.forEach((doc) => {
      backup.profiles[doc.ref.path] = doc.data();
    });

    // Roles (coach / admin role documents)
    const rolesSnap = await db.collection("roles").get();
    backup.roles = {};
    rolesSnap.forEach((doc) => {
      backup.roles[doc.id] = doc.data();
    });

    // Write backup JSON to Firebase Storage
    const fileName = `backups/weekly-${timestamp}.json`;
    const file = bucket.file(fileName);
    await file.save(JSON.stringify(backup, null, 2), {
      contentType: "application/json",
      metadata: { cacheControl: "no-cache" },
    });

    // Prune old backups — keep only the most recent 8
    const [files] = await bucket.getFiles({ prefix: "backups/weekly-" });
    const sorted = files.sort((a, b) => a.name.localeCompare(b.name));
    if (sorted.length > 8) {
      const toDelete = sorted.slice(0, sorted.length - 8);
      await Promise.all(toDelete.map((f) => f.delete()));
      functions.logger.info(`Pruned ${toDelete.length} old backup(s).`);
    }

    functions.logger.info(`Weekly backup complete: ${fileName}`);
  }
);

// ── Coach/admin sign-in via server-verified passcode ─────────────────────────
//
// Replaces the client-side passcode check in SignInV2. The passcode lives in
// Secret Manager (never in the web bundle). On a match the function finds or
// creates the coach's auth account, writes the roles document with the Admin
// SDK, and returns a custom token the client signs in with — so coach sign-in
// no longer depends on the legacy passcode-derived password, and rotating the
// passcode cannot break existing accounts.
//
// The client treats "wrong passcode" as authoritative (no fallback) but falls
// back to the legacy flow if this function is unreachable, so a function
// outage can never lock a coach out during the transition.

const COACH_PASSCODE = defineSecret("COACH_PASSCODE");
const ADMIN_COACH_PASSCODE = defineSecret("ADMIN_COACH_PASSCODE");

const ATTEMPT_COLLECTION = "authAttempts";
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_LIMIT = 8;

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest();

// Constant-time comparison via fixed-length digests.
const passcodeMatches = (entered, expected) => {
  if (!expected) return false;
  return crypto.timingSafeEqual(sha256(entered), sha256(expected));
};

const canonicalCoachEmail = (firstName, lastName) => {
  const canonical = `${firstName}${lastName}`.toLowerCase().replace(/[^a-z]/g, "");
  return canonical.length >= 2 ? `coach-${canonical}@pl.strength` : null;
};

exports.claimCoachRole = onCall(
  { secrets: [COACH_PASSCODE, ADMIN_COACH_PASSCODE] },
  async (request) => {
    const firstName = sanitizeName(request.data?.firstName);
    const lastName = sanitizeName(request.data?.lastName);
    const passcode =
      typeof request.data?.passcode === "string"
        ? request.data.passcode.trim().toUpperCase().slice(0, 32)
        : "";

    const email = canonicalCoachEmail(firstName, lastName);
    if (!email || !passcode) {
      throw new HttpsError("invalid-argument", "Enter your first and last name and the coach passcode.");
    }

    const db = getFirestore();
    const attemptRef = db
      .collection(ATTEMPT_COLLECTION)
      .doc(sha256(email).toString("hex"));

    // Brute-force limiter: once the rules are locked this callable becomes the
    // only passcode oracle, so cap guesses per coach identity per window.
    const attemptSnap = await attemptRef.get();
    const attempt = attemptSnap.exists ? attemptSnap.data() : null;
    const now = Date.now();
    const windowActive = attempt && now - (attempt.windowStartMs ?? 0) < ATTEMPT_WINDOW_MS;
    if (windowActive && (attempt.failures ?? 0) >= ATTEMPT_LIMIT) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many passcode attempts. Wait a few minutes and try again."
      );
    }

    const coachExpected = (COACH_PASSCODE.value() ?? "").trim().toUpperCase();
    const adminExpected = (ADMIN_COACH_PASSCODE.value() ?? "").trim().toUpperCase();
    const isAdmin = passcodeMatches(passcode, adminExpected);
    const isCoach = !isAdmin && passcodeMatches(passcode, coachExpected);

    if (!isAdmin && !isCoach) {
      await attemptRef.set(
        windowActive
          ? { failures: (attempt.failures ?? 0) + 1, windowStartMs: attempt.windowStartMs }
          : { failures: 1, windowStartMs: now },
        { merge: false }
      );
      functions.logger.warn("claimCoachRole: passcode mismatch", { email });
      throw new HttpsError("permission-denied", "wrong-passcode");
    }

    // Find or create the coach's auth account. Existing accounts keep their
    // uid (and therefore all their data); new accounts get a random password
    // so nothing depends on the legacy `${code}coach!` derivation.
    const auth = getAuth();
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
    } catch (err) {
      if (err?.code === "auth/user-not-found") {
        userRecord = await auth.createUser({
          email,
          password: crypto.randomBytes(32).toString("base64url"),
          displayName: `${firstName} ${lastName}`.trim(),
        });
      } else {
        throw new HttpsError("internal", "Could not look up the coach account.");
      }
    }

    // Write the roles document exactly the way the legacy client flow shaped
    // it (roles list + preserved teamScopes/teamAnchor + accessHistory entry)
    // so every existing read path keeps working. Coach passcode strips admin,
    // matching the legacy ensureCoachRoleOnly behavior.
    const roles = isAdmin ? ["admin", "coach"] : ["coach"];
    const roleRef = db.collection("roles").doc(userRecord.uid);
    const roleSnap = await roleRef.get();
    const existing = roleSnap.exists ? roleSnap.data() : {};
    const teamScopes = Array.isArray(existing.teamScopes) ? existing.teamScopes : [];
    const teamAnchor = existing.teamAnchor ?? null;

    const payload = {
      roles,
      updatedAt: FieldValue.serverTimestamp(),
      accessHistory: {
        ...asObject(existing.accessHistory),
        [passcode]: {
          roles,
          teamScopes,
          teamAnchor,
          lastUsed: FieldValue.serverTimestamp(),
        },
      },
    };
    if (teamScopes.length > 0) payload.teamScopes = teamScopes;
    if (teamAnchor) payload.teamAnchor = teamAnchor;

    await roleRef.set(payload, { merge: true });

    if (attemptSnap.exists) {
      await attemptRef.delete().catch(() => undefined);
    }

    const token = await auth.createCustomToken(userRecord.uid);

    functions.logger.info("claimCoachRole: granted", {
      uid: userRecord.uid,
      email,
      roles,
    });

    return { token, roles, teamScopes, teamAnchor };
  }
);
