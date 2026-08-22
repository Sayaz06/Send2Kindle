/**
 * Kindle Queue — Background processor
 * Runs every 2 minutes. Processes pending items for users with queueRunning=true.
 *
 * Requires Firebase secrets:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *
 * User must have refresh token stored at:
 *   users/{uid}/secrets/gmail  { refreshToken, email }
 *
 * Queue items: users/{uid}/kindle_queue/{id}
 * Settings:    users/{uid}/settings/queue  { kindleEmail, delayMinutes, queueRunning, nextSendAt }
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { google } = require("googleapis");
const fetch = require("node-fetch");

admin.initializeApp();
const db = admin.firestore();

const CLIENT_ID = defineSecret("GOOGLE_CLIENT_ID");
const CLIENT_SECRET = defineSecret("GOOGLE_CLIENT_SECRET");

async function getAccessToken(refreshToken, clientId, clientSecret) {
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2.refreshAccessToken();
  return credentials.access_token;
}

async function downloadFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

function getMimeType(fileName) {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  const map = {
    pdf: "application/pdf",
    epub: "application/epub+zip",
    mobi: "application/x-mobipocket-ebook",
    azw3: "application/vnd.amazon.ebook",
  };
  return map[ext] || "application/octet-stream";
}

async function sendViaGmail(accessToken, fromEmail, toEmail, fileName, fileBuffer) {
  const fileBase64 = fileBuffer.toString("base64");
  const mimeType = getMimeType(fileName);
  const boundary = `boundary_${Date.now()}`;

  const emailLines = [
    `To: ${toEmail}`,
    `Subject: Convert`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    ``,
    `Fail: ${fileName}`,
    `Dihantar oleh Kindle Queue Manager (background).`,
    ``,
    `--${boundary}`,
    `Content-Type: ${mimeType}; name="${fileName}"`,
    `Content-Disposition: attachment; filename="${fileName}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    fileBase64,
    `--${boundary}--`,
  ].join("\r\n");

  const encodedEmail = Buffer.from(emailLines)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const gmail = google.gmail({ version: "v1", auth: accessToken ? undefined : undefined });
  // Use raw fetch for simplicity with bearer token
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encodedEmail }),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gmail API ${response.status}`);
  }
  return response.json();
}

async function processUserQueue(uid, clientId, clientSecret) {
  const settingsRef = db.doc(`users/${uid}/settings/queue`);
  const settingsSnap = await settingsRef.get();
  if (!settingsSnap.exists) return;

  const settings = settingsSnap.data();
  if (!settings.queueRunning) return;
  if (!settings.kindleEmail) return;

  const delayMs = (settings.delayMinutes || 5) * 60 * 1000;
  const now = Date.now();
  const nextSendAt = settings.nextSendAt || 0;

  // Respect delay between sends
  if (nextSendAt && now < nextSendAt) return;

  // Get Gmail refresh token
  const secretSnap = await db.doc(`users/${uid}/secrets/gmail`).get();
  if (!secretSnap.exists || !secretSnap.data().refreshToken) {
    console.log(`No Gmail refresh token for ${uid}`);
    return;
  }
  const { refreshToken, email: fromEmail } = secretSnap.data();

  // Find next pending item
  const queueSnap = await db
    .collection(`users/${uid}/kindle_queue`)
    .where("status", "==", "pending")
    .orderBy("addedAt", "asc")
    .limit(1)
    .get();

  if (queueSnap.empty) {
    // Nothing left — stop queue
    await settingsRef.update({ queueRunning: false, nextSendAt: null });
    console.log(`Queue empty for ${uid}, stopped`);
    return;
  }

  const doc = queueSnap.docs[0];
  const item = doc.data();
  const itemRef = doc.ref;

  await itemRef.update({ status: "sending" });

  try {
    const accessToken = await getAccessToken(refreshToken, clientId, clientSecret);
    const fileBuffer = await downloadFile(item.url);
    await sendViaGmail(
      accessToken,
      fromEmail || settings.senderEmail,
      settings.kindleEmail,
      item.originalName,
      fileBuffer
    );
    await itemRef.update({ status: "sent", sentAt: Date.now(), error: null });
    await settingsRef.update({ nextSendAt: Date.now() + delayMs });
    console.log(`Sent ${item.originalName} for ${uid}`);
  } catch (err) {
    console.error(`Failed ${item.originalName}:`, err.message);
    await itemRef.update({ status: "failed", error: err.message || "Unknown error" });
    // Keep queue running — try next item after delay
    await settingsRef.update({ nextSendAt: Date.now() + delayMs });
  }
}

// Scheduled: every 2 minutes
exports.processKindleQueues = onSchedule(
  {
    schedule: "every 2 minutes",
    secrets: [CLIENT_ID, CLIENT_SECRET],
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async () => {
    const clientId = CLIENT_ID.value();
    const clientSecret = CLIENT_SECRET.value();

    // Find all users with queueRunning
    const running = await db.collectionGroup("settings")
      .where("queueRunning", "==", true)
      .get();

    for (const doc of running.docs) {
      // path: users/{uid}/settings/queue
      const parts = doc.ref.path.split("/");
      if (parts.length < 2 || parts[0] !== "users") continue;
      const uid = parts[1];
      try {
        await processUserQueue(uid, clientId, clientSecret);
      } catch (e) {
        console.error(`Error processing ${uid}:`, e.message);
      }
    }
  }
);
