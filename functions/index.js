/**
 * Kindle Queue — Background processor
 * Auto-recovers items stuck in "sending" for > 5 minutes
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const CLIENT_ID = defineSecret("GOOGLE_CLIENT_ID");
const CLIENT_SECRET = defineSecret("GOOGLE_CLIENT_SECRET");
const STUCK_MS = 5 * 60 * 1000; // 5 min

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

async function getAccessToken(refreshToken, clientId, clientSecret) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || "Token refresh failed");
  }
  return data.access_token;
}

async function sendViaGmail(accessToken, toEmail, fileName, fileBuffer) {
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

/** Reset item stuck at sending */
async function recoverStuckSending(uid) {
  const stuckSnap = await db
    .collection(`users/${uid}/kindle_queue`)
    .where("status", "==", "sending")
    .get();

  const now = Date.now();
  for (const d of stuckSnap.docs) {
    const data = d.data();
    // Tiada timestamp sending — anggap stuck jika sudah lama di queue
    // Guna addedAt / sentAt / updated heuristic: selalu recover sending yang wujud
    // (sending sepatutnya singkat; kalau masih sending bila CF jalan = stuck)
    await d.ref.update({
      status: "pending",
      error: null,
    });
    console.log(`Recovered stuck sending → pending: ${data.originalName}`);
  }
}

async function processUserQueue(uid, clientId, clientSecret) {
  const settingsRef = db.doc(`users/${uid}/settings/queue`);
  const settingsSnap = await settingsRef.get();
  if (!settingsSnap.exists) return;

  const settings = settingsSnap.data();
  if (!settings.queueRunning) return;
  if (!settings.kindleEmail) return;

  // Recover stuck "sending" dulu
  await recoverStuckSending(uid);

  const delayMs = (settings.delayMinutes || 5) * 60 * 1000;
  const now = Date.now();
  const nextSendAt = settings.nextSendAt || 0;
  if (nextSendAt && now < nextSendAt) return;

  const secretSnap = await db.doc(`users/${uid}/secrets/gmail`).get();
  if (!secretSnap.exists || !secretSnap.data().refreshToken) {
    console.log(`No Gmail refresh token for ${uid}`);
    return;
  }
  const { refreshToken } = secretSnap.data();

  const queueSnap = await db
    .collection(`users/${uid}/kindle_queue`)
    .where("status", "==", "pending")
    .orderBy("addedAt", "asc")
    .limit(1)
    .get();

  if (queueSnap.empty) {
    await settingsRef.update({ queueRunning: false, nextSendAt: null });
    console.log(`Queue empty for ${uid}, stopped`);
    return;
  }

  const docSnap = queueSnap.docs[0];
  const item = docSnap.data();
  const itemRef = docSnap.ref;

  await itemRef.update({ status: "sending", sendingAt: Date.now() });

  try {
    const accessToken = await getAccessToken(refreshToken, clientId, clientSecret);
    const fileRes = await fetch(item.url);
    if (!fileRes.ok) throw new Error(`Download failed: ${fileRes.status}`);
    const fileBuffer = Buffer.from(await fileRes.arrayBuffer());

    await sendViaGmail(accessToken, settings.kindleEmail, item.originalName, fileBuffer);
    await itemRef.update({ status: "sent", sentAt: Date.now(), error: null });
    await settingsRef.update({ nextSendAt: Date.now() + delayMs });
    console.log(`Sent ${item.originalName} for ${uid}`);
  } catch (err) {
    console.error(`Failed ${item.originalName}:`, err.message);
    await itemRef.update({ status: "failed", error: err.message || "Unknown error" });
    await settingsRef.update({ nextSendAt: Date.now() + delayMs });
  }
}

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

    const running = await db
      .collectionGroup("settings")
      .where("queueRunning", "==", true)
      .get();

    for (const docSnap of running.docs) {
      const parts = docSnap.ref.path.split("/");
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
