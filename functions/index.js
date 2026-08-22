/**
 * Kindle Queue — Background processor
 * Uses top-level active_queues/{uid} to avoid collectionGroup index issues
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const CLIENT_ID = defineSecret("GOOGLE_CLIENT_ID");
const CLIENT_SECRET = defineSecret("GOOGLE_CLIENT_SECRET");

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
  console.log("getAccessToken: clientId =", clientId ? clientId.slice(0, 20) + "..." : "KOSONG");
  console.log("getAccessToken: clientSecret =", clientSecret ? "****" + clientSecret.slice(-4) : "KOSONG");
  console.log("getAccessToken: refreshToken =", refreshToken ? refreshToken.slice(0, 10) + "..." : "KOSONG");

  const params = new URLSearchParams({
    client_id: clientId.trim(),
    client_secret: clientSecret.trim(),
    refresh_token: refreshToken.trim(),
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const data = await res.json();
  console.log("Token response status:", res.status);
  console.log("Token response:", JSON.stringify({
    has_access_token: !!data.access_token,
    error: data.error,
    error_description: data.error_description,
  }));

  if (!data.access_token) {
    throw new Error(`Token refresh failed: ${data.error} — ${data.error_description}`);
  }
  return data.access_token;
}

async function sendViaGmail(accessToken, toEmail, fileName, fileBuffer) {
  const fileBase64 = fileBuffer.toString("base64");
  const mimeType = getMimeType(fileName);
  const boundary = `boundary_${Date.now()}`;

  const emailLines = [
    `To: ${toEmail}`,
    `Subject: `,
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
    console.error("Gmail send error:", JSON.stringify(err));
    throw new Error(err.error?.message || `Gmail API ${response.status}`);
  }
  return response.json();
}

async function recoverStuckSending(uid) {
  const stuckSnap = await db
    .collection(`users/${uid}/kindle_queue`)
    .where("status", "==", "sending")
    .get();

  for (const d of stuckSnap.docs) {
    await d.ref.update({ status: "pending", error: null });
    console.log(`Recovered stuck sending → pending: ${d.data().originalName}`);
  }
}

async function processUserQueue(uid, clientId, clientSecret) {
  console.log(`processUserQueue START: uid=${uid}`);

  const settingsRef = db.doc(`users/${uid}/settings/queue`);
  const settingsSnap = await settingsRef.get();
  if (!settingsSnap.exists) {
    console.log(`No settings/queue for ${uid}`);
    return;
  }

  const settings = settingsSnap.data();
  console.log(`settings.queueRunning=${settings.queueRunning}, kindleEmail=${settings.kindleEmail}`);

  if (!settings.queueRunning) {
    await db.doc(`active_queues/${uid}`).delete().catch(() => {});
    console.log(`queueRunning=false, deleted active_queues/${uid}`);
    return;
  }
  if (!settings.kindleEmail) {
    console.log(`No kindleEmail for ${uid}`);
    return;
  }

  await recoverStuckSending(uid);

  const delayMs = (settings.delayMinutes || 5) * 60 * 1000;
  const now = Date.now();
  const nextSendAt = settings.nextSendAt || 0;
  if (nextSendAt && now < nextSendAt) {
    console.log(`Delay not reached. Next: ${new Date(nextSendAt).toISOString()}`);
    return;
  }

  const secretSnap = await db.doc(`users/${uid}/secrets/gmail`).get();
  if (!secretSnap.exists || !secretSnap.data().refreshToken) {
    console.log(`No Gmail refresh token for ${uid}`);
    return;
  }
  const { refreshToken } = secretSnap.data();
  console.log(`refreshToken found: ${refreshToken.slice(0, 10)}...`);

  let queueSnap;
  try {
    queueSnap = await db
      .collection(`users/${uid}/kindle_queue`)
      .where("status", "==", "pending")
      .orderBy("addedAt", "asc")
      .limit(1)
      .get();
  } catch (idxErr) {
    console.error("orderBy index missing — please create index in Firestore:", idxErr.message);
    return;
  }

  if (queueSnap.empty) {
    await settingsRef.update({ queueRunning: false, nextSendAt: null });
    await db.doc(`active_queues/${uid}`).delete().catch(() => {});
    console.log(`Queue empty for ${uid}, stopped`);
    return;
  }

  const docs = queueSnap.docs.slice().sort((a, b) => (a.data().addedAt || 0) - (b.data().addedAt || 0));
  const docSnap = docs[0];
  const item = docSnap.data();
  const itemRef = docSnap.ref;

  console.log(`Processing item: ${item.originalName}`);
  await itemRef.update({ status: "sending", sendingAt: Date.now() });

  try {
    const accessToken = await getAccessToken(refreshToken, clientId, clientSecret);
    console.log(`Access token obtained, downloading file...`);

    const fileRes = await fetch(item.url);
    if (!fileRes.ok) throw new Error(`Download failed: ${fileRes.status}`);
    const fileBuffer = Buffer.from(await fileRes.arrayBuffer());
    console.log(`File downloaded: ${fileBuffer.length} bytes`);

    await sendViaGmail(accessToken, settings.kindleEmail, item.originalName, fileBuffer);
    await itemRef.update({ status: "sent", sentAt: Date.now(), error: null });
    await settingsRef.update({ nextSendAt: Date.now() + delayMs });
    console.log(`SUCCESS: Sent ${item.originalName} for ${uid}`);
  } catch (err) {
    console.error(`FAILED ${item.originalName}: ${err.message}`);
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
    console.log("processKindleQueues TRIGGERED:", new Date().toISOString());
    const clientId = CLIENT_ID.value();
    const clientSecret = CLIENT_SECRET.value();
    console.log("Secrets loaded. clientId starts:", clientId ? clientId.slice(0, 15) : "EMPTY");

    const running = await db.collection("active_queues").get();
    console.log(`active_queues count: ${running.size}`);

    if (running.empty) {
      console.log("No active queues found. Exiting.");
      return;
    }

    for (const docSnap of running.docs) {
      const uid = docSnap.id;
      console.log(`Processing uid: ${uid}`);
      try {
        await processUserQueue(uid, clientId, clientSecret);
      } catch (e) {
        console.error(`Error processing ${uid}:`, e.message);
      }
    }

    console.log("processKindleQueues DONE");
  }
);
